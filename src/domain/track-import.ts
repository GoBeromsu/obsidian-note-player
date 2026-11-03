import type { YoutubePlaylistPropertyMapping } from '../types/settings';
import { buildYoutubeThumbnailUrl, buildYoutubeWatchUrl } from '../utils/youtube';

export interface TrackMeta {
  videoId: string;
  title: string;
  author: string;
}

export interface FlatPlaylist {
  title: string;
  entries: TrackMeta[];
}

export type ImportPlan =
  | { action: 'create' }
  | { action: 'reuse'; path: string }
  | { action: 'already-in-playlist'; path: string };

export const FLAT_PLAYLIST_PRINT = '%(id)s\t%(title)s\t%(uploader)s\t%(playlist_title)s';

const VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;

export function parseOembed(json: unknown): { title: string; author: string } | null {
  if (typeof json !== 'object' || json === null) return null;
  const record = json as Record<string, unknown>;
  const title = asText(record.title);
  if (!title) return null;
  return { title, author: asText(record.author_name) };
}

/** Import saves the bare video id as the title when oEmbed fails (private or removed videos). */
export function isUnavailable(track: { title: string; artist: string; videoId: string }): boolean {
  return !track.artist && track.title === track.videoId;
}

export const LOADING_TITLE = 'Loading title…';

/** `inFlight` = a resolve or heal is running; any other state (failed, no title, cached audio) is unavailable. */
export function titleState(
  track: { title: string; artist: string; videoId: string },
  loading: boolean,
): 'ready' | 'loading' | 'unavailable' {
  if (!isUnavailable(track)) return 'ready';
  return loading ? 'loading' : 'unavailable';
}

export function trackLabel(track: { title: string; artist: string; videoId: string }, midSentence = false): string {
  if (!isUnavailable(track)) return track.title;
  return midSentence ? 'unavailable video' : 'Unavailable video';
}

export function buildMusicFrontmatter(
  meta: TrackMeta,
  mapping: YoutubePlaylistPropertyMapping,
): Record<string, string> {
  const frontmatter: Record<string, string> = {
    type: mapping.musicNoteType,
  };
  if (mapping.musicUrlProperty.trim()) frontmatter[mapping.musicUrlProperty] = buildYoutubeWatchUrl(meta.videoId);
  if (mapping.musicArtistProperty.trim() && meta.author) frontmatter[mapping.musicArtistProperty] = meta.author;
  if (mapping.musicThumbnailProperty.trim()) frontmatter[mapping.musicThumbnailProperty] = buildYoutubeThumbnailUrl(meta.videoId);
  return frontmatter;
}

/** Notes linking to `filePath`, split into playlists (relinked by the heal) and anything else (renaming would break those). */
export function classifyBacklinks(
  resolvedLinks: Record<string, Record<string, number>>,
  filePath: string,
  playlistPaths: ReadonlySet<string>,
): { playlistSources: string[]; elsewhere: boolean } {
  const sources = Object.keys(resolvedLinks).filter((source) => resolvedLinks[source]?.[filePath]);
  return {
    playlistSources: sources.filter((source) => playlistPaths.has(source)),
    elsewhere: sources.some((source) => !playlistPaths.has(source)),
  };
}

export function classifyImport(
  videoId: string,
  tracks: ReadonlyArray<{ path: string; videoId: string }>,
  playlistTrackPaths: readonly string[],
): ImportPlan {
  const existing = tracks.find((track) => track.videoId === videoId);
  if (!existing) return { action: 'create' };
  return playlistTrackPaths.includes(existing.path)
    ? { action: 'already-in-playlist', path: existing.path }
    : { action: 'reuse', path: existing.path };
}

export function parseFlatPlaylistOutput(stdout: string): FlatPlaylist {
  const result: FlatPlaylist = { title: '', entries: [] };
  for (const line of stdout.split('\n')) {
    const [id = '', title = '', author = '', playlistTitle = ''] = line.replace(/\r$/, '').split('\t');
    if (!VIDEO_ID_PATTERN.test(id)) continue;
    result.title ||= asText(playlistTitle);
    result.entries.push({ videoId: id, title: asText(title) || id, author: asText(author) });
  }
  return result;
}

// yt-dlp prints "NA" for missing fields
function asText(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return text === 'NA' ? '' : text;
}
