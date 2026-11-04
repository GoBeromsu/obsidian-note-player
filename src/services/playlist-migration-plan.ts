import { getFrontMatterInfo, parseYaml, stringifyYaml, type App, type TFile } from 'obsidian';
import { LEGACY_TRACKS_KEY } from '../domain/config';
import { planPlaylistMigration, type MigrationPlaylistInput, type PlaylistMigrationPlan, type PlaylistCardsUpgrade } from '../domain/playlist-migration';
import { upgradePlaylistCards } from '../domain/base-cards';
import type { NotePlayerSettings } from '../types/settings';
import { hasType } from '../utils/frontmatter';
import { parsePlaylistTrackReference } from '../utils/wikilink';
import { migrationEmbeds, migrationEmbedReviewReason } from './migration-content';
import { resolvePlaylistBase } from './embed-resolution';

// A base created before an interrupted conversion must be recoverable without claiming a user's base.
export const MIGRATION_BASE_MARKER = '# note-player migration for: ';

export interface MigrationFailure {
	readonly path: string;
	readonly reason: string;
}

export interface MigrationScan {
	readonly plan: PlaylistMigrationPlan;
	readonly failures: readonly MigrationFailure[];
	readonly candidates: readonly TFile[];
	readonly frontmatter: ReadonlyMap<string, Record<string, unknown>>;
}

export async function collectMigrationPlan(app: App, settings: NotePlayerSettings, notePath?: string): Promise<MigrationScan> {
	const legacyKey = settings.legacyPlaylistTrackProperty ?? LEGACY_TRACKS_KEY;
	const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const rawCandidate = new RegExp(`(?:^[ \\t]*(?:#[ \\t]*)?(?:-[ \\t]+)?|[{,][ \\t]*)["']?(?:${escapePattern(legacyKey)}["']?[ \\t]*:|type["']?[ \\t]*:\\s*["']?${escapePattern(settings.playlistNoteType)}["']?(?=[\\s,}]|$))`, 'm');
	const folder = settings.playlistFolder.replace(/^\/|\/$/g, '');
	const playlists: MigrationPlaylistInput[] = [];
	const cardsUpgrades = new Map<string, PlaylistCardsUpgrade>();
	const failures: MigrationFailure[] = [];
	const candidates: TFile[] = [];
	const frontmatters = new Map<string, Record<string, unknown>>();
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
			const content = await app.vault.cachedRead(file);
			const info = getFrontMatterInfo(content);
			let parsed: unknown;
			try {
				parsed = info.exists ? parseYaml(info.frontmatter) : {};
			} catch (error: unknown) {
				if (rawCandidate.test(info.frontmatter)) {
					const reason = error instanceof Error ? error.message : String(error);
					failures.push({ path: file.path, reason: `Needs review: playlist YAML could not be parsed: ${reason}` });
				}
				continue;
			}
			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
			const frontmatter = Object.fromEntries(Object.entries(parsed));
			if (!hasType(frontmatter, settings.playlistNoteType)) continue;
			candidates.push(file);
			frontmatters.set(file.path, frontmatter);
			const raw: unknown = frontmatter[legacyKey] ?? frontmatter.tracks_legacy;
			const refs: unknown[] = Array.isArray(raw) ? raw : [];
			const embeds = migrationEmbeds(content, { app, notePath: file.path });
			if (embeds.needsReview) throw new Error(migrationEmbedReviewReason(embeds));
			const pairedBase = resolvePlaylistBase(app, file, embeds.embeddedBases);
			if (pairedBase && !cardsUpgrades.has(pairedBase.path)) {
				try {
					const before = await app.vault.read(pairedBase);
					const after = upgradePlaylistCards(before, settings.musicThumbnailProperty, { parse: parseYaml, stringify: stringifyYaml });
					if (before !== after) cardsUpgrades.set(pairedBase.path, { notePath: file.path, basePath: pairedBase.path, before, after });
				} catch (error: unknown) {
					const reason = error instanceof Error ? error.message : String(error);
					failures.push({ path: pairedBase.path, reason: `Needs review: playlist base YAML could not be upgraded: ${reason}` });
					continue;
				}
			}
			const embeddedBases = new Set([...embeds.ownedBases, ...embeds.embeddedBases]);
			let pendingBase: string | undefined;
			if (!embeddedBases.size) {
				const marker = `${MIGRATION_BASE_MARKER}${JSON.stringify(file.path)}\n`;
				for (const path of existingPaths) {
					const base = path.endsWith('.base') ? app.vault.getFileByPath(path) : null;
					if (base && (await app.vault.read(base)).startsWith(marker)) {
						if (pendingBase) throw new Error('Needs review: multiple owned companion bases exist; skipped.');
						pendingBase = base.path;
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
				pendingBase, ownedBase: embeds.ownedBases[0],
			});
		} catch (error: unknown) {
			failures.push({ path: file.path, reason: error instanceof Error ? error.message : String(error) });
		}
	}
	return {
		plan: {
			...planPlaylistMigration({ playlists, trackMembership: membership, mapping: settings, existingPaths }),
			cardsUpgrades: [...cardsUpgrades.values()],
		},
		failures,
		candidates,
		frontmatter: frontmatters,
	};
}
