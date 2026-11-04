import type { MusicLibrarySnapshot, MusicTrack, PlaylistNote } from '../types/music';
import type { MarkdownNoteSnapshot } from '../types/notes';
import type { YoutubePlaylistPropertyMapping } from '../types/settings';
import { hasType, asStringArray, asTrimmedString } from '../utils/frontmatter';
import { buildYoutubeThumbnailUrl, buildYoutubeWatchUrl, extractYoutubeVideoId } from '../utils/youtube';
import { linkDisplayText } from '../utils/wikilink';
import { parseBaseSort, sortTracks } from './base-sort';
import { isUnavailable } from './track-import';

export function buildMusicLibrary(
  notes: MarkdownNoteSnapshot[],
  propertyMapping: YoutubePlaylistPropertyMapping,
  baseConfigs: Map<string, unknown>,
): MusicLibrarySnapshot {
  const tracks = notes
    .map((note) => toMusicTrack(note, propertyMapping))
    .filter((track): track is MusicTrack => track !== null)
    .sort((left, right) => left.title.localeCompare(right.title));
  const snapshotsByPath = new Map(notes.map((note) => [note.path, note]));
  const companions = notes.filter((note) =>
    hasType(note.frontmatter, propertyMapping.playlistNoteType) && note.embeddedBases.length > 0);
  const membersByPlaylist = new Map(companions.map((note) => [note.path, new Set<MusicTrack>()]));
  for (const track of tracks) {
    const links: unknown = snapshotsByPath.get(track.path)?.frontmatterLinks[propertyMapping.playlistMembershipProperty];
    if (!Array.isArray(links)) continue;
    for (const path of links) {
      if (typeof path === 'string') membersByPlaylist.get(path)?.add(track);
    }
  }
  const playlists: PlaylistNote[] = [];
  for (const note of companions) {
    const basePath = note.embeddedBases[0];
    if (!basePath) continue;
    const members = sortTracks(
      [...(membersByPlaylist.get(note.path) ?? [])],
      parseBaseSort(baseConfigs.get(basePath)),
      snapshotsByPath,
    );
    playlists.push({
      path: note.path,
      basePath,
      title: note.basename,
      coverUrl: asTrimmedString(note.frontmatter?.[propertyMapping.playlistCoverProperty]) ?? '',
      description: asTrimmedString(note.frontmatter?.[propertyMapping.playlistDescriptionProperty]) ?? '',
      trackPaths: members.map((track) => track.path),
      tracks: members,
    });
  }
  playlists.sort((left, right) => left.title.localeCompare(right.title));
  return { tracks, playlists };
}

function toMusicTrack(
  note: MarkdownNoteSnapshot,
  propertyMapping: YoutubePlaylistPropertyMapping,
): MusicTrack | null {
  if (!hasType(note.frontmatter, propertyMapping.musicNoteType)) return null;
  const sourceUrl = asTrimmedString(note.frontmatter?.[propertyMapping.musicUrlProperty]);
  if (!sourceUrl) return null;
  const videoId = extractYoutubeVideoId(sourceUrl);
  if (!videoId) return null;
  const artist = asStringArray(note.frontmatter?.[propertyMapping.musicArtistProperty]).map((value) => linkDisplayText(value)).join(', ');
  return {
    path: note.path,
    // A note saved under its bare id may carry the real title in metadata when renaming it would break links.
    title: note.basename === videoId ? asTrimmedString(note.frontmatter?.title) ?? note.basename : note.basename,
    artist,
    sourceUrl,
    watchUrl: buildYoutubeWatchUrl(videoId),
    videoId,
    thumbnailUrl: isUnavailable({ title: note.basename, artist, videoId }) ? '' : buildYoutubeThumbnailUrl(videoId),
    tags: asStringArray(note.frontmatter?.tags),
  };
}
