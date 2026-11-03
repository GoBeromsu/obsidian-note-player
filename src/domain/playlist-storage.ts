import type { YoutubePlaylistPropertyMapping } from '../types/settings';
import { canonicalizeNotePath, parsePlaylistTrackReference, toObsidianWikilink } from '../utils/wikilink';
import { DEFAULT_PROPERTY_MAPPING, getLegacyPlaylistTrackProperty } from './config';

const FRONTMATTER_PATTERN = /^---\n[\s\S]*?\n---\n*/;

export interface PlaylistDocumentInput {
  trackPaths: string[];
  coverUrl?: string;
  description?: string;
}

/**
 * Playlist notes persist canonical vault-relative note targets as Obsidian
 * wikilinks under the configured track-list property. The loader still accepts
 * either raw paths or wikilinks for backwards compatibility.
 */
export function createPlaylistNoteContent(
  input: PlaylistDocumentInput,
  propertyMapping: YoutubePlaylistPropertyMapping = DEFAULT_PROPERTY_MAPPING,
): string {
  return updatePlaylistNoteContent('', input, propertyMapping);
}

export function updatePlaylistNoteContent(
  existingContent: string,
  input: PlaylistDocumentInput,
  propertyMapping: YoutubePlaylistPropertyMapping = DEFAULT_PROPERTY_MAPPING,
): string {
  const body = stripFrontmatter(existingContent);
  const noteType = propertyMapping.playlistNoteType;
  const frontmatter = serializeFrontmatter({
    type: noteType,
    [getLegacyPlaylistTrackProperty(propertyMapping)]: dedupeTrackPaths(input.trackPaths),
    [propertyMapping.playlistCoverProperty]: input.coverUrl,
    [propertyMapping.playlistDescriptionProperty]: input.description,
  });

  const trimmedBody = body.trimStart();
  return trimmedBody ? `${frontmatter}\n${trimmedBody}` : `${frontmatter}\n`;
}

export function dedupeTrackPaths(trackPaths: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const trackPath of trackPaths) {
    const normalized = canonicalizeNotePath(trackPath);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    deduped.push(toObsidianWikilink(normalized));
  }

  return deduped;
}

/**
 * Writes `trackPaths` as links while keeping every entry the plugin doesn't own
 * (unresolved links, plain text, non-strings) verbatim at its original index.
 */
export function mergeTrackEntries(
  existing: readonly unknown[],
  trackPaths: readonly string[],
  isOwned: (entry: string) => boolean,
): unknown[] {
  const links = dedupeTrackPaths([...trackPaths]);
  const written = new Set(trackPaths.map((path) => canonicalizeNotePath(path).toLowerCase()));
  const merged: unknown[] = [...links];
  existing.forEach((entry, index) => {
    if (typeof entry === 'string' && isOwned(entry)) return;
    const target = typeof entry === 'string' ? parsePlaylistTrackReference(entry)?.normalized.toLowerCase() : undefined;
    if (target && written.has(target)) return;
    merged.splice(Math.min(index, merged.length), 0, entry);
  });
  return merged;
}

function stripFrontmatter(content: string): string {
  return content.replace(FRONTMATTER_PATTERN, '');
}

function serializeFrontmatter(fields: Record<string, unknown>): string {
  const lines = ['---'];

  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) {
      continue;
    }

    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`);
        continue;
      }

      lines.push(`${key}:`);
      for (const entry of value) {
        lines.push(`  - ${serializeScalar(entry)}`);
      }
      continue;
    }

    lines.push(`${key}: ${serializeScalar(value)}`);
  }

  lines.push('---');
  return lines.join('\n');
}

function serializeScalar(value: unknown): string {
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return JSON.stringify(String(value));
}
