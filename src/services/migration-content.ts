import { getFrontMatterInfo, parseYaml, stringifyYaml, type App } from 'obsidian';
import { inspectMigrationEmbeds, migrationEmbedBlock } from '../domain/migration-embeds';
import type { PlaylistMigration } from '../domain/playlist-migration';
import type { NotePlayerSettings } from '../types/settings';
import { LEGACY_TRACKS_KEY } from '../domain/config';
import { hasType } from '../utils/frontmatter';
import { resolveEmbeddedFile } from './embed-resolution';

export function migrationFrontmatter(content: string): Record<string, unknown> {
	const info = getFrontMatterInfo(content);
	const parsed: unknown = info.exists ? parseYaml(info.frontmatter) : {};
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error('Playlist frontmatter must be a mapping.');
	}
	return Object.fromEntries(Object.entries(parsed));
}

export interface MigrationContentSource {
	readonly app: App;
	readonly notePath: string;
}

export function migrationEmbeds(content: string, source: MigrationContentSource) {
	const info = getFrontMatterInfo(content);
	return inspectMigrationEmbeds(content.slice(info.exists ? info.contentStart : 0), (linktext) =>
		resolveEmbeddedFile(source.app, linktext, source.notePath));
}

export function migrationEmbedReviewReason(embeds: ReturnType<typeof migrationEmbeds>): string {
	const unresolved = embeds.unresolvedEmbeds;
	return unresolved.length
		? `Needs review: ${unresolved.join(', ')} ${unresolved.length === 1 ? 'does' : 'do'} not point to a .base file; include .base in the embed link.`
		: 'Needs review: companion embed is ambiguous; skipped.';
}

export function alreadyConverted(content: string, source: MigrationContentSource, settings: NotePlayerSettings): boolean {
	const embeds = migrationEmbeds(content, source);
	const fm = migrationFrontmatter(content);
	const key = settings.legacyPlaylistTrackProperty ?? LEGACY_TRACKS_KEY;
	const path = embeds.embeddedBases[0];
	return !embeds.needsReview && embeds.embeddedBases.length === 1
		&& path !== undefined && source.app.vault.getFileByPath(path)?.extension === 'base'
		&& hasType(fm, settings.playlistNoteType)
		&& (!Object.hasOwn(fm, 'tracks_legacy') || Array.isArray(fm.tracks_legacy))
		&& (key === 'tracks_legacy' || !Object.hasOwn(fm, key));
}

export interface MigrationNoteEdit {
	readonly playlist: PlaylistMigration;
	readonly settings: NotePlayerSettings;
	readonly app: App;
	readonly frontmatter: Record<string, unknown>;
}

/** Called only inside Vault.process, so both decisions describe the same current bytes. */
export function convertMigrationContent(content: string, edit: MigrationNoteEdit): string {
	const { playlist, settings, app, frontmatter: preview } = edit;
	const fm = migrationFrontmatter(content);
	if (!hasType(fm, settings.playlistNoteType) || JSON.stringify(fm) !== JSON.stringify(preview)) {
		throw new Error('Playlist changed after preview. Run the converter again.');
	}
	const embeds = migrationEmbeds(content, { app, notePath: playlist.notePath });
	if (embeds.needsReview) throw new Error(migrationEmbedReviewReason(embeds));
	const paired = embeds.ownedBases[0] ?? embeds.embeddedBases[0];
	if (paired && paired !== playlist.basePath) {
		throw new Error('Playlist companion changed after preview. Run the converter again.');
	}
	const key = settings.legacyPlaylistTrackProperty ?? LEGACY_TRACKS_KEY;
	let updated = content;
	if (Object.hasOwn(fm, key) && key !== 'tracks_legacy') {
		if (Object.hasOwn(fm, 'tracks_legacy')) throw new Error('tracks_legacy already exists; skipped.');
		if (!Array.isArray(fm[key])) throw new Error('Legacy track list changed; run the converter again.');
		const info = getFrontMatterInfo(content);
		fm.tracks_legacy = fm[key];
		delete fm[key];
		updated = `${content.slice(0, info.from)}${stringifyYaml(fm).trimEnd()}\n${content.slice(info.to)}`;
	}
	if (!paired && playlist.appendEmbed) updated += `\n${migrationEmbedBlock(playlist.basePath)}\n`;
	return updated;
}
