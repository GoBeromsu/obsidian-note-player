import { Component, getFrontMatterInfo, Notice, parseYaml, type App } from 'obsidian';
import { createPlaylistBaseContent } from '../domain/base-files';
import { LEGACY_TRACKS_KEY } from '../domain/config';
import { NOTICE_CATALOG, renderNotice } from '../domain/notices';
import type { PlaylistMigration } from '../domain/playlist-migration';
import type { NotePlayerSettings } from '../types/settings';
import { hasType } from '../utils/frontmatter';
import { linkDisplayText, parsePlaylistTrackReference, toObsidianWikilink } from '../utils/wikilink';
import { showNotice } from '../ui/notices';
import { MigrationPreviewModal } from '../ui/views/MigrationPreviewModal';
import { collectMigrationPlan, MIGRATION_BASE_MARKER, type MigrationFailure, type MigrationScan } from './playlist-migration-plan';
import { withMetadataSettled } from './vault-io';
import { alreadyConverted, convertMigrationContent, migrationEmbeds, migrationFrontmatter } from './migration-content';
import { resolveEmbeddedFile, resolvePlaylistBase } from './embed-resolution';

interface MigrationHost extends Pick<Component, 'addChild' | 'removeChild'> {
	readonly app: App;
	readonly settings: NotePlayerSettings;
	saveSettings(): Promise<void>;
}

interface MigrationRun {
	readonly host: MigrationHost;
	readonly owner: Component;
	readonly signal: AbortSignal;
}

// Hold the lock through preview dismissal and all writes, including settings persistence.
const running = new WeakMap<App, Promise<void>>();

export function convertPlaylistNotes(host: MigrationHost): Promise<void> {
	const pending = running.get(host.app);
	if (pending) return pending;
	const owner = host.addChild(new Component());
	const controller = new AbortController();
	owner.register(() => controller.abort(new Error('Playlist conversion cancelled.')));
	const run = { host, owner, signal: controller.signal };
	const promise = Promise.resolve().then(() => previewMigration(run)).catch((error: unknown) => {
		if (!run.signal.aborted) showNotice('migration_failed', { name: 'Playlists', reason: error instanceof Error ? error.message : String(error) });
	}).finally(() => {
		host.removeChild(owner);
		running.delete(host.app);
	});
	running.set(host.app, promise);
	return promise;
}

function needsConversion(playlist: PlaylistMigration): boolean {
	return playlist.createBase || playlist.appendEmbed || playlist.renameLegacyKey || playlist.membershipAdds.length > 0;
}

async function previewMigration(run: MigrationRun): Promise<void> {
	const { host, signal, owner } = run;
	signal.throwIfAborted();
	const scan = await collectMigrationPlan(host.app, host.settings);
	signal.throwIfAborted();
	const { plan, failures } = scan;
	for (const { path: name, reason } of failures) {
		if (name.endsWith('.base')) showNotice('base_unreadable', { name: name.split('/').pop() ?? name });
		else showNotice('migration_failed', { name, reason });
	}
	if (!plan.totals.playlists && !plan.cardsUpgrades?.length && !plan.conflicts.length && !plan.invalid.length) {
		if (failures.length) return;
		const noOpSettings = { ...host.settings };
		const cleanup = await clearLegacySetting(run);
		signal.throwIfAborted();
		for (const { path: name, reason } of cleanup) showNotice('migration_failed', { name, reason });
		if (cleanup.length) return;
		const remaining: string[] = [];
		for (const file of scan.candidates) {
			if (host.app.vault.getFileByPath(file.path) !== file
				|| !alreadyConverted(await host.app.vault.read(file), { app: host.app, notePath: file.path }, noOpSettings)) remaining.push(file.path);
		}
		signal.throwIfAborted();
		if (remaining.length) {
			for (const name of remaining) showNotice('migration_failed', { name, reason: 'Needs review: playlist still needs conversion.' });
			return;
		}
		showNotice('migration_already_bases');
		return;
	}
	let confirm: (confirmed: boolean) => void = () => {};
	const confirmation = new Promise<boolean>((resolve) => { confirm = resolve; });
	const modal = new MigrationPreviewModal(host.app, plan, confirm);
	owner.register(() => { confirm(false); modal.close(); });
	modal.open();
	if (await confirmation) {
		try {
			await applyMigration(run, scan, (current, total, path, state) => modal.showProgress(current, total, path, state));
		} finally {
			modal.close();
		}
	}
}

async function applyMigration(
	run: MigrationRun,
	scan: MigrationScan,
	reportProgress: (current: number, total: number, path: string, state: 'converting' | 'converted' | 'failed') => void,
): Promise<void> {
	const { host, signal, owner } = run;
	const { app, settings } = host;
	const { plan: preview } = scan;
	let progress: Notice | undefined;
	const converted = new Set<string>();
	let linked = 0;
	let missing = 0;
	let upgraded = 0;
	const errors = new Set<string>();
	try {
		const playlists = preview.playlists.filter(needsConversion);
		for (const [index, playlist] of playlists.entries()) {
			signal.throwIfAborted();
			reportProgress(index + 1, playlists.length, playlist.notePath, 'converting');
			const message = renderNotice(NOTICE_CATALOG.migration_progress.template, { name: linkDisplayText(playlist.notePath, true) });
			if (progress) progress.setMessage(message);
			else progress = new Notice(message, 0);
			try {
				const current = await collectMigrationPlan(app, settings, playlist.notePath);
				signal.throwIfAborted();
				const failure = current.failures.find((entry) => entry.path === playlist.notePath);
				if (failure) throw new Error(failure.reason);
				const fresh = current.plan.playlists.find((entry) => entry.notePath === playlist.notePath);
				if (fresh && !needsConversion(fresh)) continue;
				if (!fresh || JSON.stringify(fresh) !== JSON.stringify(playlist)) {
					throw new Error('Playlist changed after preview. Run the converter again.');
				}
				const note = app.vault.getFileByPath(playlist.notePath);
				if (!note) throw new Error('Playlist note no longer exists.');
				const frontmatter = current.frontmatter.get(note.path);
				if (!frontmatter) throw new Error('Playlist frontmatter is unavailable.');
				let preparedFrontmatter = frontmatter;
				// Archive first; append only once the base resolves, leaving every interruption recoverable.
				let indexed = await withMetadataSettled({ app, owner }, note, async () => {
					await app.vault.process(note, (content) => {
						signal.throwIfAborted();
						const updated = convertMigrationContent(content, {
							playlist: { ...playlist, appendEmbed: playlist.appendEmbed && !playlist.createBase },
							settings, app, frontmatter,
						});
						preparedFrontmatter = migrationFrontmatter(updated);
						return updated;
					});
				});
				signal.throwIfAborted();
				if (playlist.createBase) {
					await app.vault.create(playlist.basePath,
						`${MIGRATION_BASE_MARKER}${JSON.stringify(note.path)}\n${createPlaylistBaseContent(settings)}`);
					signal.throwIfAborted();
					indexed = await withMetadataSettled({ app, owner }, note, async () => {
						await app.vault.process(note, (content) => {
							signal.throwIfAborted();
							return convertMigrationContent(content, { playlist, settings, app, frontmatter: preparedFrontmatter });
						});
					});
				}
				signal.throwIfAborted();
				if (indexed && (indexed.embeds ?? []).filter((embed) =>
					resolveEmbeddedFile(app, embed.link, note.path)?.path === playlist.basePath).length !== 1) {
					throw new Error('Companion base embed was not preserved. Run the converter again.');
				}
				for (const [trackIndex, path] of playlist.membershipAdds.entries()) {
					signal.throwIfAborted();
					const track = app.vault.getFileByPath(path);
					if (!track) throw new Error(`Track no longer exists: ${path}`);
					let added = false;
					const writeMembership = () => app.fileManager.processFrontMatter(track, (fm: Record<string, unknown>) => {
						signal.throwIfAborted();
						const raw = fm[settings.playlistMembershipProperty];
						const entries: unknown[] = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
						const alreadyLinked = entries.some((entry) => {
							if (typeof entry !== 'string') return false;
							const ref = parsePlaylistTrackReference(entry);
							return ref && app.metadataCache.getFirstLinkpathDest(ref.normalized, track.path)?.path === note.path;
						});
						if (!alreadyLinked) {
							fm[settings.playlistMembershipProperty] = [...entries, toObsidianWikilink(note.path)];
							added = true;
						}
					});
					if (trackIndex === playlist.membershipAdds.length - 1) {
						await withMetadataSettled({ app, owner }, track, writeMembership);
					} else {
						await writeMembership();
					}
					if (added) linked++;
				}
				const finalContent = await app.vault.read(note);
				signal.throwIfAborted();
				const final = migrationEmbeds(finalContent, { app, notePath: note.path });
				const fm = migrationFrontmatter(finalContent);
				const key = settings.legacyPlaylistTrackProperty ?? LEGACY_TRACKS_KEY;
				if (final.needsReview || final.embeddedBases.length !== 1
					|| final.embeddedBases[0] !== playlist.basePath
					|| !hasType(fm, settings.playlistNoteType)
					|| JSON.stringify(fm.tracks_legacy) !== JSON.stringify(frontmatter[key] ?? frontmatter.tracks_legacy)
					|| key !== 'tracks_legacy' && Object.hasOwn(fm, key)) {
					throw new Error('Companion embed or archive was not preserved. Run the converter again.');
				}
				converted.add(playlist.notePath);
				missing += playlist.missing.length;
				reportProgress(index + 1, playlists.length, playlist.notePath, 'converted');
			} catch (error: unknown) {
				if (signal.aborted) throw error;
				reportProgress(index + 1, playlists.length, playlist.notePath, 'failed');
				const reason = error instanceof Error ? error.message : String(error);
				errors.add(`${playlist.notePath}: ${reason}`);
				showNotice('migration_failed', { name: playlist.notePath, reason });
			}
		}
		for (const upgrade of preview.cardsUpgrades ?? []) {
			signal.throwIfAborted();
			reportProgress(upgraded + 1, preview.cardsUpgrades?.length ?? 0, upgrade.basePath, 'converting');
			try {
				const note = app.vault.getFileByPath(upgrade.notePath);
				const content = note ? await app.vault.read(note) : '';
				const embeds = migrationEmbeds(content, { app, notePath: upgrade.notePath });
				const base = note && !embeds.needsReview && resolvePlaylistBase(app, note, embeds.embeddedBases);
				if (!base || base.path !== upgrade.basePath
					|| !hasType(migrationFrontmatter(content), settings.playlistNoteType)) {
					throw new Error('Playlist pairing changed after preview. Run the converter again.');
				}
				await app.vault.process(base, (content) => {
					signal.throwIfAborted();
					if (content !== upgrade.before) throw new Error('Playlist base changed after preview. Run the converter again.');
					return upgrade.after;
				});
				upgraded++;
				reportProgress(upgraded, preview.cardsUpgrades?.length ?? 0, upgrade.basePath, 'converted');
			} catch (error: unknown) {
				if (signal.aborted) throw error;
				const reason = error instanceof Error ? error.message : String(error);
				errors.add(`${upgrade.basePath}: ${reason}`);
				reportProgress(upgraded + 1, preview.cardsUpgrades?.length ?? 0, upgrade.basePath, 'failed');
				showNotice('migration_failed', { name: upgrade.basePath, reason });
			}
		}
		for (const { path, reason } of await clearLegacySetting(run)) errors.add(`${path}: ${reason}`);
		signal.throwIfAborted();
	} finally {
		progress?.hide();
	}
	const summary = [
		...(converted.size ? [renderNotice(NOTICE_CATALOG.migration_complete.template, { playlists: converted.size, tracks: linked, missing })] : []),
		...(upgraded ? [renderNotice(NOTICE_CATALOG.migration_cards_complete.template, { bases: upgraded })] : []),
	];
	const skipped = [...preview.conflicts, ...preview.invalid];
	const message = [...summary, ...errors, ...(skipped.length ? [`Skipped: ${skipped.join(', ')}.`] : [])].join('\n');
	if (message) new Notice(message);
}

async function clearLegacySetting(run: MigrationRun): Promise<MigrationFailure[]> {
	const { host, signal } = run;
	signal.throwIfAborted();
	const key = host.settings.legacyPlaylistTrackProperty;
	if (key === undefined) return [];
	// Inspect the entire vault, not just the configured folder, before forgetting a custom key.
	for (const file of host.app.vault.getMarkdownFiles()) {
		try {
			const content = await host.app.vault.cachedRead(file);
			signal.throwIfAborted();
			const info = getFrontMatterInfo(content);
			let fm: unknown;
			try {
				fm = info.exists ? parseYaml(info.frontmatter) : {};
			} catch (error: unknown) {
				// Unreadable YAML may hide the custom key; retain it without blaming unrelated notes.
				if (error instanceof Error) return [];
				throw error;
			}
			if (fm && typeof fm === 'object' && !Array.isArray(fm)) {
				const record = Object.fromEntries(Object.entries(fm));
				if (hasType(record, host.settings.playlistNoteType) && Object.hasOwn(record, key)) return [];
			}
		} catch (error: unknown) {
			if (signal.aborted) throw error;
			return [{ path: file.path, reason: error instanceof Error ? error.message : String(error) }];
		}
	}
	delete host.settings.legacyPlaylistTrackProperty;
	try {
		await host.saveSettings();
		signal.throwIfAborted();
		return [];
	} catch (error: unknown) {
		host.settings.legacyPlaylistTrackProperty = key;
		if (signal.aborted) throw error;
		return [{ path: 'Playlist settings', reason: error instanceof Error ? error.message : String(error) }];
	}
}
