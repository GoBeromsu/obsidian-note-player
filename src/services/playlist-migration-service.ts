import { getFrontMatterInfo, Notice, parseYaml, type App } from 'obsidian';
import { createPlaylistBaseContent } from '../domain/base-files';
import { LEGACY_TRACKS_KEY } from '../domain/config';
import { NOTICE_CATALOG, renderNotice } from '../domain/notices';
import type { PlaylistMigration } from '../domain/playlist-migration';
import type { NotePlayerSettings } from '../types/settings';
import { hasType } from '../utils/frontmatter';
import { embeddedWikilinks, parsePlaylistTrackReference, toObsidianWikilink } from '../utils/wikilink';
import { showNotice } from '../ui/notices';
import { MigrationPreviewModal } from '../ui/views/MigrationPreviewModal';
import { collectMigrationPlan, MIGRATION_BASE_MARKER, type MigrationFailure, type MigrationScan } from './playlist-migration-plan';
import { withMetadataSettled } from './vault-io';

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
		const cleanup = await clearLegacySetting(host);
		for (const { path: name, reason } of cleanup) showNotice('migration_failed', { name, reason });
		if (cleanup.length) return;
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
				const hasEmbed = (content: string) => embeddedWikilinks(content.slice(getFrontMatterInfo(content).contentStart))
					.some((link) => app.metadataCache.getFirstLinkpathDest(link, note.path)?.path === playlist.basePath);
				if (playlist.createBase) {
					await app.vault.create(playlist.basePath,
						`${MIGRATION_BASE_MARKER}${JSON.stringify(note.path)}\n${createPlaylistBaseContent(settings)}`);
				}
				const editsNote = playlist.appendEmbed || playlist.renameLegacyKey;
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
					if (!editsNote && trackIndex === playlist.membershipAdds.length - 1) {
						await withMetadataSettled(app, track, writeMembership);
					} else {
						await writeMembership();
					}
					if (added) linked++;
				}
				await withMetadataSettled(app, note, async () => {
					await app.vault.process(note, (content) => hasEmbed(content) ? content : `${content}\n![[${playlist.basePath}]]\n`);
					if (playlist.renameLegacyKey) {
						const key = settings.legacyPlaylistTrackProperty ?? LEGACY_TRACKS_KEY;
						await app.fileManager.processFrontMatter(note, (fm: Record<string, unknown>) => {
							if (Object.hasOwn(fm, 'tracks_legacy')) throw new Error('tracks_legacy already exists; skipped.');
							if (!Array.isArray(fm[key])) throw new Error('Legacy track list changed; run the converter again.');
							fm.tracks_legacy = fm[key];
							delete fm[key];
						});
					}
				});
				if (!hasEmbed(await app.vault.read(note))) {
					throw new Error('Companion base embed was not preserved. Run the converter again.');
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
