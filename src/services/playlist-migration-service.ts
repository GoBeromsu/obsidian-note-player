import { getFrontMatterInfo, Notice, parseYaml, type App, type TFile } from 'obsidian';
import { createPlaylistBaseContent } from '../domain/base-files';
import { LEGACY_TRACKS_KEY } from '../domain/config';
import { NOTICE_CATALOG, renderNotice } from '../domain/notices';
import { planPlaylistMigration, type PlaylistMigration, type PlaylistMigrationPlan } from '../domain/playlist-migration';
import type { NotePlayerSettings } from '../types/settings';
import { hasType } from '../utils/frontmatter';
import { parsePlaylistTrackReference, toObsidianWikilink } from '../utils/wikilink';
import { showNotice } from '../ui/notices';
import { MigrationPreviewModal } from '../ui/views/MigrationPreviewModal';
import { waitForMetadata } from './vault-io';

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

async function collectPlan(host: MigrationHost): Promise<PlaylistMigrationPlan> {
	const { app, settings } = host;
	const legacyKey = settings.legacyPlaylistTrackProperty ?? LEGACY_TRACKS_KEY;
	const folder = settings.playlistFolder.replace(/^\/|\/$/g, '');
	const playlists = [];
	const membership = new Map<string, string[]>();
	const resolve = (raw: unknown, source: string): TFile | null => {
		if (typeof raw !== 'string') return null;
		const ref = parsePlaylistTrackReference(raw);
		if (!ref) return null;
		const file = app.metadataCache.getFirstLinkpathDest(ref.normalized, source);
		return file?.extension === 'md' ? file : null;
	};

	for (const file of app.vault.getMarkdownFiles()) {
		const cache = app.metadataCache.getFileCache(file);
		if (!cache?.frontmatter) continue;
		const inFolder = !folder || file.path.startsWith(`${folder}/`);
		if (!inFolder || !hasType(cache.frontmatter, settings.playlistNoteType)) continue;
		// Read the current bytes too: a second invocation can beat metadata-cache reparsing.
		const content = await app.vault.read(file);
		const info = getFrontMatterInfo(content);
		const parsed: unknown = info.exists ? parseYaml(info.frontmatter) : {};
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
		const frontmatter = Object.fromEntries(Object.entries(parsed));
		const raw: unknown = frontmatter[legacyKey] ?? frontmatter.tracks_legacy;
		const refs: unknown[] = Array.isArray(raw) ? raw : [];
		const embeddedBases = new Set<string>();
		const links = [
			...(cache.embeds ?? []).filter((embed) => content.includes(embed.original)).map((embed) => embed.link),
			...Array.from(content.slice(info.contentStart).matchAll(/!\[\[([^\]\n]+)\]\]/g), (match) => (match[1] ?? '').split('|')[0] ?? ''),
		];
		for (const link of links) {
			const base = app.metadataCache.getFirstLinkpathDest(link, file.path);
			if (base?.extension === 'base') embeddedBases.add(base.path);
		}
		const paths = refs.map((ref) => resolve(ref, file.path)?.path ?? null);
		playlists.push({
			path: file.path, basename: file.basename, folder: file.parent?.path ?? '',
			frontmatter, trackRefs: refs, resolvedTrackPaths: paths, embeddedBases: [...embeddedBases],
		});
		for (const path of paths) {
			if (!path || membership.has(path)) continue;
			const track = app.vault.getFileByPath(path);
			if (!track) continue;
			const trackContent = await app.vault.read(track);
			const trackInfo = getFrontMatterInfo(trackContent);
			const trackFm: unknown = trackInfo.exists ? parseYaml(trackInfo.frontmatter) : {};
			const value: unknown = trackFm && typeof trackFm === 'object'
				? Reflect.get(trackFm, settings.playlistMembershipProperty) : undefined;
			const entries: unknown[] = Array.isArray(value) ? value : value === undefined ? [] : [value];
			membership.set(path, entries.flatMap((entry) => {
				const target = resolve(entry, path);
				return target ? [target.path] : [];
			}));
		}
	}
	return planPlaylistMigration({
		playlists, trackMembership: membership, mapping: settings,
		existingPaths: new Set(app.vault.getAllLoadedFiles().map((file) => file.path)),
	});
}

async function previewMigration(host: MigrationHost): Promise<void> {
	const plan = await collectPlan(host);
	if (!plan.totals.playlists && !plan.conflicts.length && !plan.invalid.length) {
		await clearLegacySetting(host);
		showNotice('migration_already_bases');
		return;
	}
	const confirmed = await new Promise<boolean>((resolve) => {
		new MigrationPreviewModal(host.app, plan, resolve).open();
	});
	if (confirmed) await applyMigration(host, plan);
}

async function applyMigration(host: MigrationHost, preview: PlaylistMigrationPlan): Promise<void> {
	const { app, settings } = host;
	const progress = new Notice('', 0);
	let converted = 0;
	let linked = 0;
	let missing = 0;
	const errors: string[] = [];
	try {
		for (const playlist of preview.playlists.filter(needsConversion)) {
			progress.setMessage(renderNotice(NOTICE_CATALOG.migration_progress.template, { name: playlist.notePath }));
			try {
				const current = await collectPlan(host);
				const fresh = current.playlists.find((entry) => entry.notePath === playlist.notePath);
				if (fresh && !needsConversion(fresh)) continue;
				if (!fresh || JSON.stringify(fresh) !== JSON.stringify(playlist)) {
					throw new Error('Playlist changed after preview. Run the converter again.');
				}
				const note = app.vault.getFileByPath(playlist.notePath);
				if (!note) throw new Error('Playlist note no longer exists.');
				if (playlist.createBase) {
					await app.vault.create(playlist.basePath, createPlaylistBaseContent(settings));
				}
				let lastTrack: TFile | undefined;
				for (const path of playlist.membershipAdds) {
					const track = app.vault.getFileByPath(path);
					if (!track) throw new Error(`Track no longer exists: ${path}`);
					let added = false;
					await app.fileManager.processFrontMatter(track, (fm: Record<string, unknown>) => {
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
					if (added) linked++;
					lastTrack = track;
				}
				if (lastTrack) await waitForMetadata(app, lastTrack);
				if (playlist.appendEmbed) {
					const embed = `![[${playlist.basePath}]]`;
					await app.vault.process(note, (content) => content.includes(embed) ? content : `${content}\n${embed}\n`);
				}
				if (playlist.renameLegacyKey) {
					const key = settings.legacyPlaylistTrackProperty ?? LEGACY_TRACKS_KEY;
					await app.fileManager.processFrontMatter(note, (fm: Record<string, unknown>) => {
						if (Object.hasOwn(fm, 'tracks_legacy')) throw new Error('tracks_legacy already exists; skipped.');
						if (!Array.isArray(fm[key])) throw new Error('Legacy track list changed; run the converter again.');
						fm.tracks_legacy = fm[key];
						delete fm[key];
					});
				}
				converted++;
				missing += playlist.missing.length;
			} catch (error: unknown) {
				const reason = error instanceof Error ? error.message : String(error);
				errors.push(`${playlist.notePath}: ${reason}`);
				showNotice('migration_failed', { name: playlist.notePath, reason });
			}
		}
		await clearLegacySetting(host);
	} finally {
		progress.hide();
	}
	const summary = renderNotice(NOTICE_CATALOG.migration_complete.template, { playlists: converted, tracks: linked, missing });
	const skipped = [...preview.conflicts, ...preview.invalid];
	new Notice([summary, ...errors, ...(skipped.length ? [`Skipped: ${skipped.join(', ')}.`] : [])].join('\n'));
}

async function clearLegacySetting(host: MigrationHost): Promise<void> {
	const key = host.settings.legacyPlaylistTrackProperty;
	if (key === undefined) return;
	// Inspect the entire vault, not just the configured folder, before forgetting a custom key.
	for (const file of host.app.vault.getMarkdownFiles()) {
		const content = await host.app.vault.read(file);
		const info = getFrontMatterInfo(content);
		const fm: unknown = info.exists ? parseYaml(info.frontmatter) : {};
		if (fm && typeof fm === 'object' && !Array.isArray(fm)) {
			const record = Object.fromEntries(Object.entries(fm));
			if (hasType(record, host.settings.playlistNoteType) && Object.hasOwn(record, key)) return;
		}
	}
	delete host.settings.legacyPlaylistTrackProperty;
	await host.saveSettings();
}
