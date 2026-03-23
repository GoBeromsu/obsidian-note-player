import type { YoutubePlaylistPropertyMapping } from '../types/settings';
import { canonicalizeNotePath, toObsidianWikilink } from '../utils/wikilink';
import { DEFAULT_PROPERTY_MAPPING } from './config';

const FRONTMATTER_PATTERN = /^---\n[\s\S]*?\n---\n*/;

export const PLAYLIST_NOTE_TYPE = 'music-playlist';

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
  const noteType = propertyMapping.playlistNoteType ?? PLAYLIST_NOTE_TYPE;
  const frontmatter = serializeFrontmatter({
    type: noteType,
    [propertyMapping.playlistTrackProperty]: dedupeTrackPaths(input.trackPaths),
    [propertyMapping.playlistCoverProperty]: input.coverUrl,
    [propertyMapping.playlistDescriptionProperty]: input.description,
  });

  const trimmedBody = body.trimStart();
  return trimmedBody ? `${frontmatter}\n${trimmedBody}` : `${frontmatter}\n`;
}

function dedupeTrackPaths(trackPaths: string[]): string[] {
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
