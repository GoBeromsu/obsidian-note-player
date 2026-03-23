import type { MusicLibrarySnapshot, MusicTrack, PlaylistNote } from '../types/music';
import type { MarkdownNoteSnapshot } from '../types/notes';
import type { YoutubePlaylistPropertyMapping } from '../types/settings';
import { dedupe } from '../utils/dedupe';
import { hasType, asStringArray, asTrimmedString } from '../utils/frontmatter';
import { buildYoutubeEmbedUrl, buildYoutubeThumbnailUrl, buildYoutubeWatchUrl, extractYoutubeVideoId } from '../utils/youtube';
import { canonicalizeNotePath, parsePlaylistTrackReference } from '../utils/wikilink';
import { DEFAULT_PROPERTY_MAPPING } from './config';

interface TrackResolver {
  byPath: Map<string, string>;
  byStem: Map<string, string>;
}

export function buildMusicLibrary(
  notes: MarkdownNoteSnapshot[],
  propertyMapping: YoutubePlaylistPropertyMapping = DEFAULT_PROPERTY_MAPPING,
): MusicLibrarySnapshot {
  const tracks = notes
    .map((note) => toMusicTrack(note, propertyMapping))
    .filter((track): track is MusicTrack => track !== null)
    .sort((left, right) => left.title.localeCompare(right.title));

  const resolver = buildTrackResolver(tracks);

  const playlists = notes
    .map((note) => toPlaylistNote(note, tracks, resolver, propertyMapping))
    .filter((playlist): playlist is PlaylistNote => playlist !== null)
    .sort((left, right) => left.title.localeCompare(right.title));

  return { tracks, playlists };
}

function toMusicTrack(
  note: MarkdownNoteSnapshot,
  propertyMapping: YoutubePlaylistPropertyMapping,
): MusicTrack | null {
  if (!hasType(note.frontmatter, propertyMapping.musicNoteType)) {
    return null;
  }

  const sourceUrl = firstAvailableString(note.frontmatter, propertyMapping.musicUrlProperties);
  if (!sourceUrl) {
    return null;
  }

  const videoId = extractYoutubeVideoId(sourceUrl);
  if (!videoId) {
    return null;
  }

  const imageUrl = firstAvailableString(note.frontmatter, propertyMapping.musicThumbnailProperties) ?? buildYoutubeThumbnailUrl(videoId);
  const artist = firstAvailableString(note.frontmatter, propertyMapping.musicArtistProperties) ?? '';

  return {
    path: note.path,
    title: note.basename,
    artist,
    sourceUrl,
    watchUrl: buildYoutubeWatchUrl(videoId),
    embedUrl: buildYoutubeEmbedUrl(videoId),
    videoId,
    thumbnailUrl: buildYoutubeThumbnailUrl(videoId),
    imageUrl,
    tags: asStringArray(note.frontmatter?.tags),
  };
}

function toPlaylistNote(
  note: MarkdownNoteSnapshot,
  tracks: MusicTrack[],
  resolver: TrackResolver,
  propertyMapping: YoutubePlaylistPropertyMapping,
): PlaylistNote | null {
  const rawTrackRefs = asStringArray(note.frontmatter?.[propertyMapping.playlistTrackProperty]);
  const isPlaylist =
    hasType(note.frontmatter, propertyMapping.playlistNoteType) ||
    (hasType(note.frontmatter, 'playlist') && rawTrackRefs.length > 0);

  if (!isPlaylist) {
    return null;
  }

  const resolvedTrackPaths: string[] = [];
  const missingTrackPaths: string[] = [];

  for (const rawTrackRef of rawTrackRefs) {
    const reference = parsePlaylistTrackReference(rawTrackRef);
    if (!reference) {
      continue;
    }

    const resolved = resolveTrackPath(reference.normalized, resolver);
    if (resolved) {
      resolvedTrackPaths.push(resolved);
    } else {
      missingTrackPaths.push(reference.normalized);
    }
  }

  const uniqueTrackPaths = dedupe(resolvedTrackPaths);
  const trackLookup = new Map(tracks.map((track) => [track.path, track]));

  return {
    path: note.path,
    title: note.basename,
    coverUrl: firstAvailableString(note.frontmatter, [propertyMapping.playlistCoverProperty]) ?? '',
    description: firstAvailableString(note.frontmatter, [propertyMapping.playlistDescriptionProperty]) ?? '',
    trackPaths: uniqueTrackPaths,
    tracks: uniqueTrackPaths
      .map((trackPath) => trackLookup.get(trackPath) ?? null)
      .filter((track): track is MusicTrack => track !== null),
    missingTrackPaths: dedupe(missingTrackPaths),
  };
}

function buildTrackResolver(tracks: MusicTrack[]): TrackResolver {
  const byPath = new Map<string, string>();
  const byStemCounts = new Map<string, number>();
  const byStemValues = new Map<string, string>();

  for (const track of tracks) {
    byPath.set(track.path.toLowerCase(), track.path);

    const stem = getPathStem(track.path).toLowerCase();
    byStemCounts.set(stem, (byStemCounts.get(stem) ?? 0) + 1);
    byStemValues.set(stem, track.path);
  }

  const byStem = new Map<string, string>();
  for (const [stem, count] of byStemCounts.entries()) {
    if (count === 1) {
      byStem.set(stem, byStemValues.get(stem) as string);
    }
  }

  return { byPath, byStem };
}

function resolveTrackPath(reference: string, resolver: TrackResolver): string | null {
  const normalized = canonicalizeNotePath(reference).toLowerCase();
  return resolver.byPath.get(normalized) ?? resolver.byStem.get(getPathStem(normalized)) ?? null;
}

function getPathStem(path: string): string {
  const basename = path.split('/').pop() ?? path;
  return basename.toLowerCase().replace(/\.md$/i, '');
}

function firstAvailableString(
  frontmatter: Record<string, unknown> | undefined,
  keys: string[],
): string | null {
  if (!frontmatter) {
    return null;
  }

  for (const key of keys) {
    const value = asTrimmedString(frontmatter[key]);
    if (value) {
      return value;
    }
  }

  return null;
}

