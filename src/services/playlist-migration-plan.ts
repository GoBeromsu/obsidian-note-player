import { getFrontMatterInfo, parseYaml, type App, type TFile } from 'obsidian';
import { LEGACY_TRACKS_KEY } from '../domain/config';
import { planPlaylistMigration, type MigrationPlaylistInput, type PlaylistMigrationPlan } from '../domain/playlist-migration';
import type { NotePlayerSettings } from '../types/settings';
import { hasType } from '../utils/frontmatter';
import { parsePlaylistTrackReference } from '../utils/wikilink';
import { settledMigrationMetadata } from './migration-metadata';

// A base created before an interrupted conversion must be recoverable without claiming a user's base.
export const MIGRATION_BASE_MARKER = '# note-player migration for: ';

export interface MigrationFailure {
	readonly path: string;
	readonly reason: string;
}

export interface MigrationScan {
	readonly plan: PlaylistMigrationPlan;
	readonly failures: readonly MigrationFailure[];
}

export async function collectMigrationPlan(app: App, settings: NotePlayerSettings, notePath?: string): Promise<MigrationScan> {
	const legacyKey = settings.legacyPlaylistTrackProperty ?? LEGACY_TRACKS_KEY;
	const folder = settings.playlistFolder.replace(/^\/|\/$/g, '');
	const playlists: MigrationPlaylistInput[] = [];
	const failures: MigrationFailure[] = [];
	const membership = new Map<string, string[]>();
	const existingPaths = new Set(app.vault.getAllLoadedFiles().map((file) => file.path));
	const resolve = (raw: unknown, source: string): TFile | null => {
		if (typeof raw !== 'string') return null;
		const ref = parsePlaylistTrackReference(raw);
		if (!ref) return null;
		const file = app.metadataCache.getFirstLinkpathDest(ref.normalized, source);
		return file?.extension === 'md' ? file : null;
	};

	for (const file of app.vault.getMarkdownFiles()) {
		if (notePath && file.path !== notePath) continue;
		if (folder && !file.path.startsWith(`${folder}/`)) continue;
		try {
			const content = await app.vault.read(file);
			const info = getFrontMatterInfo(content);
			const parsed: unknown = info.exists ? parseYaml(info.frontmatter) : {};
			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
			const frontmatter = Object.fromEntries(Object.entries(parsed));
			if (!hasType(frontmatter, settings.playlistNoteType)) continue;
			const cache = app.metadataCache.getFileCache(file) ?? (await settledMigrationMetadata(app, file)).cache;
			if (!cache || [legacyKey, 'tracks_legacy'].some((key) =>
				JSON.stringify(cache.frontmatter?.[key]) !== JSON.stringify(frontmatter[key]))) {
				throw new Error('Metadata is not ready. Wait for indexing and run the converter again.');
			}
			const raw: unknown = frontmatter[legacyKey] ?? frontmatter.tracks_legacy;
			const refs: unknown[] = Array.isArray(raw) ? raw : [];
			const embeddedBases = new Set<string>();
			for (const embed of cache.embeds ?? []) {
				const base = app.metadataCache.getFirstLinkpathDest(embed.link, file.path);
				if (base?.extension === 'base') embeddedBases.add(base.path);
			}
			let pendingBase: string | undefined;
			if (!embeddedBases.size) {
				const marker = `${MIGRATION_BASE_MARKER}${JSON.stringify(file.path)}\n`;
				for (const path of existingPaths) {
					const base = path.endsWith('.base') ? app.vault.getFileByPath(path) : null;
					if (base && (await app.vault.read(base)).startsWith(marker)) {
						pendingBase = base.path;
						break;
					}
				}
			}
			const paths = refs.map((ref) => resolve(ref, file.path)?.path ?? null);
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
			playlists.push({
				path: file.path, basename: file.basename, folder: file.parent?.path ?? '',
				frontmatter, trackRefs: refs, resolvedTrackPaths: paths, embeddedBases: [...embeddedBases],
				pendingBase,
			});
		} catch (error: unknown) {
			failures.push({ path: file.path, reason: error instanceof Error ? error.message : String(error) });
		}
	}
	return {
		plan: planPlaylistMigration({ playlists, trackMembership: membership, mapping: settings, existingPaths }),
		failures,
	};
}
