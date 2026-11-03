import { getFrontMatterInfo, Notice, parseYaml, type App } from 'obsidian';
import { createPlaylistBaseContent } from '../domain/base-files';
import { LEGACY_TRACKS_KEY } from '../domain/config';
import { NOTICE_CATALOG, renderNotice } from '../domain/notices';
import type { PlaylistMigration } from '../domain/playlist-migration';
import type { NotePlayerSettings } from '../types/settings';
import { hasType } from '../utils/frontmatter';
import { parsePlaylistTrackReference, toObsidianWikilink } from '../utils/wikilink';
import { showNotice } from '../ui/notices';
import { MigrationPreviewModal } from '../ui/views/MigrationPreviewModal';
import { collectMigrationPlan, MIGRATION_BASE_MARKER, type MigrationFailure, type MigrationScan } from './playlist-migration-plan';
import { withMetadataSettled } from './vault-io';
import { alreadyConverted, convertMigrationContent, migrationEmbeds, migrationFrontmatter } from './migration-content';

interface MigrationHost {
	readonly app: App;
	readonly settings: NotePlayerSettings;
	saveSettings(): Promise<void>;
}

// Hold the lock through preview dismissal and all writes, including settings persistence.
const running = new WeakMap<App, Promise<void>>();

export function convertPlaylistNotes(host: MigrationHost): Promise<void> {
	const pending = running.get(host.app);
	if (pending) return pending;
	const run = Promise.resolve().then(() => previewMigration(host)).catch((error: unknown) => {
		showNotice('migration_failed', { name: 'Playlists', reason: error instanceof Error ? error.message : String(error) });
	}).finally(() => running.delete(host.app));
	running.set(host.app, run);
	return run;
}

function needsConversion(playlist: PlaylistMigration): boolean {
	return playlist.createBase || playlist.appendEmbed || playlist.renameLegacyKey || playlist.membershipAdds.length > 0;
}

async function previewMigration(host: MigrationHost): Promise<void> {
	const scan = await collectMigrationPlan(host.app, host.settings);
	const { plan, failures } = scan;
	for (const { path: name, reason } of failures) showNotice('migration_failed', { name, reason });
	if (!plan.totals.playlists && !plan.conflicts.length && !plan.invalid.length) {
		if (failures.length) return;
		const noOpSettings = { ...host.settings };
		const cleanup = await clearLegacySetting(host);
		for (const { path: name, reason } of cleanup) showNotice('migration_failed', { name, reason });
		if (cleanup.length) return;
		const basePaths = host.app.vault.getAllLoadedFiles().filter((file) => file.path.endsWith('.base')).map((file) => file.path);
		const remaining: string[] = [];
		for (const file of scan.candidates) {
			if (host.app.vault.getFileByPath(file.path) !== file
				|| !alreadyConverted(await host.app.vault.read(file), basePaths, noOpSettings)) remaining.push(file.path);
		}
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
	modal.open();
	if (await confirmation) {
		try {
			await applyMigration(host, scan, (current, total, path, state) => modal.showProgress(current, total, path, state));
		} finally {
			modal.close();
		}
	}
}

async function applyMigration(
	host: MigrationHost,
	scan: MigrationScan,
	reportProgress: (current: number, total: number, path: string, state: 'converting' | 'converted' | 'failed') => void,
): Promise<void> {
	const { app, settings } = host;
	const { plan: preview, failures } = scan;
	const progress = new Notice('', 0);
	let converted = 0;
	let linked = 0;
	let missing = 0;
	const errors = new Set(failures.map(({ path, reason }) => `${path}: ${reason}`));
	try {
		const playlists = preview.playlists.filter(needsConversion);
		for (const [index, playlist] of playlists.entries()) {
			reportProgress(index + 1, playlists.length, playlist.notePath, 'converting');
			progress.setMessage(renderNotice(NOTICE_CATALOG.migration_progress.template, { name: playlist.notePath }));
			try {
				const current = await collectMigrationPlan(app, settings, playlist.notePath);
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
				const basePaths = app.vault.getAllLoadedFiles().filter((file) => file.path.endsWith('.base')).map((file) => file.path);
				// Write the pairing before creating its base, so a racing embed cannot create a second base.
				const indexed = await withMetadataSettled(app, note, async () => {
					await app.vault.process(note, (content) => convertMigrationContent(content, {
						playlist, settings, basePaths, frontmatter,
					}));
				});
				if (indexed && (indexed.embeds ?? []).filter((embed) =>
					embed.link.split('|')[0] === playlist.basePath
					|| embed.link.split('|')[0] === playlist.basePath.replace(/\.base$/, '')).length !== 1) {
					throw new Error('Companion base embed was not preserved. Run the converter again.');
				}
				if (playlist.createBase) {
					await app.vault.create(playlist.basePath,
						`${MIGRATION_BASE_MARKER}${JSON.stringify(note.path)}\n${createPlaylistBaseContent(settings)}`);
				}
				for (const [trackIndex, path] of playlist.membershipAdds.entries()) {
					const track = app.vault.getFileByPath(path);
					if (!track) throw new Error(`Track no longer exists: ${path}`);
					let added = false;
					const writeMembership = () => app.fileManager.processFrontMatter(track, (fm: Record<string, unknown>) => {
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
						await withMetadataSettled(app, track, writeMembership);
					} else {
						await writeMembership();
					}
					if (added) linked++;
				}
				const finalContent = await app.vault.read(note);
				const final = migrationEmbeds(finalContent, [...basePaths, playlist.basePath]);
				const fm = migrationFrontmatter(finalContent);
				const key = settings.legacyPlaylistTrackProperty ?? LEGACY_TRACKS_KEY;
				if (final.needsReview || final.embeddedBases.length !== 1
					|| final.embeddedBases[0] !== playlist.basePath
					|| !hasType(fm, settings.playlistNoteType)
					|| JSON.stringify(fm.tracks_legacy) !== JSON.stringify(frontmatter[key] ?? frontmatter.tracks_legacy)
					|| key !== 'tracks_legacy' && Object.hasOwn(fm, key)) {
					throw new Error('Companion embed or archive was not preserved. Run the converter again.');
				}
				converted++;
				missing += playlist.missing.length;
				reportProgress(index + 1, playlists.length, playlist.notePath, 'converted');
			} catch (error: unknown) {
				reportProgress(index + 1, playlists.length, playlist.notePath, 'failed');
				const reason = error instanceof Error ? error.message : String(error);
				errors.add(`${playlist.notePath}: ${reason}`);
				showNotice('migration_failed', { name: playlist.notePath, reason });
			}
		}
		for (const { path, reason } of await clearLegacySetting(host)) errors.add(`${path}: ${reason}`);
	} finally {
		progress.hide();
	}
	const summary = renderNotice(NOTICE_CATALOG.migration_complete.template, { playlists: converted, tracks: linked, missing });
	const skipped = [...preview.conflicts, ...preview.invalid];
	new Notice([summary, ...errors, ...(skipped.length ? [`Skipped: ${skipped.join(', ')}.`] : [])].join('\n'));
}

async function clearLegacySetting(host: MigrationHost): Promise<MigrationFailure[]> {
	const key = host.settings.legacyPlaylistTrackProperty;
	if (key === undefined) return [];
	// Inspect the entire vault, not just the configured folder, before forgetting a custom key.
	for (const file of host.app.vault.getMarkdownFiles()) {
		try {
			const content = await host.app.vault.read(file);
			const info = getFrontMatterInfo(content);
			const fm: unknown = info.exists ? parseYaml(info.frontmatter) : {};
			if (fm && typeof fm === 'object' && !Array.isArray(fm)) {
				const record = Object.fromEntries(Object.entries(fm));
				if (hasType(record, host.settings.playlistNoteType) && Object.hasOwn(record, key)) return [];
			}
		} catch (error: unknown) {
			return [{ path: file.path, reason: error instanceof Error ? error.message : String(error) }];
		}
	}
	delete host.settings.legacyPlaylistTrackProperty;
	try {
		await host.saveSettings();
		return [];
	} catch (error: unknown) {
		host.settings.legacyPlaylistTrackProperty = key;
		return [{ path: 'Playlist settings', reason: error instanceof Error ? error.message : String(error) }];
	}
}
