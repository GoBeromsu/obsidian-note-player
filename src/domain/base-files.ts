import type { YoutubePlaylistPropertyMapping } from '../types/settings';
import { DEFAULT_PROPERTY_MAPPING, getLegacyPlaylistTrackProperty } from './config';

export const MUSIC_BASE_NAME = 'Music.base';
export const PLAYLISTS_BASE_NAME = 'Playlists.base';

export interface CompanionBaseFile {
  path: string;
  content: string;
}

export function buildCompanionBaseFiles(
  playlistFolder: string,
  propertyMapping: YoutubePlaylistPropertyMapping = DEFAULT_PROPERTY_MAPPING,
): CompanionBaseFile[] {
  const folder = getCompanionBaseFolder(playlistFolder);

  return [
    {
      path: joinVaultPath(folder, MUSIC_BASE_NAME),
      content: createMusicBaseContent(propertyMapping),
    },
    {
      path: joinVaultPath(folder, PLAYLISTS_BASE_NAME),
      content: createPlaylistBaseContent(propertyMapping),
    },
  ];
}

export function getCompanionBaseFolder(playlistFolder: string): string {
  const segments = playlistFolder
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length <= 1) {
    return segments[0] ?? '';
  }

  return segments.slice(0, -1).join('/');
}

function createMusicBaseContent(propertyMapping: YoutubePlaylistPropertyMapping): string {
	const artistProperty = propertyMapping.musicArtistProperty;
	const thumbnailProperty = propertyMapping.musicThumbnailProperty;
  const urlProperty = propertyMapping.musicUrlProperty;

	return [
		'filters:',
		'  and:',
		'    - \'type == "music"\'',
		'views:',
		'  - type: cards',
		'    name: "Library"',
		'    order:',
		'      - file.name',
		`      - ${serializeValue(artistProperty)}`,
		`      - ${serializeValue(thumbnailProperty)}`,
		`      - ${serializeValue(urlProperty)}`,
		'  - type: table',
		'    name: "Table"',
		'    order:',
		'      - file.name',
		`      - ${serializeValue(artistProperty)}`,
		`      - ${serializeValue(urlProperty)}`,
		'      - file.folder',
		'      - file.mtime',
		'properties:',
		`  ${serializeKey(thumbnailProperty)}:`,
		'    displayName: "Thumbnail"',
    `  ${serializeKey(artistProperty)}:`,
    '    displayName: "Artist"',
    `  ${serializeKey(urlProperty)}:`,
    '    displayName: "YouTube URL"',
    '',
  ].join('\n');
}

function createPlaylistBaseContent(propertyMapping: YoutubePlaylistPropertyMapping): string {
	const trackProperty = getLegacyPlaylistTrackProperty(propertyMapping);
	const descriptionProperty = propertyMapping.playlistDescriptionProperty;
	const coverProperty = propertyMapping.playlistCoverProperty;
	const trackCountFormula = buildTrackCountFormula(trackProperty);

	return [
		'filters:',
		'  and:',
		'    - \'type == "music-playlist"\'',
		'formulas:',
		`  track_count: ${JSON.stringify(trackCountFormula)}`,
		'views:',
		'  - type: table',
		'    name: "Playlists"',
		'    order:',
		'      - file.name',
		'      - formula.track_count',
		`      - ${serializeValue(descriptionProperty)}`,
		`      - ${serializeValue(trackProperty)}`,
		`      - ${serializeValue(coverProperty)}`,
		'      - file.mtime',
		'  - type: cards',
		'    name: "Cards"',
		'    order:',
		'      - file.name',
		`      - ${serializeValue(coverProperty)}`,
		`      - ${serializeValue(descriptionProperty)}`,
		'      - formula.track_count',
		'properties:',
		`  ${serializeKey(trackProperty)}:`,
		'    displayName: "Tracks"',
		`  ${serializeKey(descriptionProperty)}:`,
		'    displayName: "Description"',
		`  ${serializeKey(coverProperty)}:`,
		'    displayName: "Cover"',
		'  formula.track_count:',
		'    displayName: "Count"',
		'',
	].join('\n');
}

function joinVaultPath(folder: string, fileName: string): string {
  return folder ? `${folder}/${fileName}` : fileName;
}

function serializeKey(value: string): string {
  return needsQuotes(value) ? JSON.stringify(value) : value;
}

function serializeValue(value: string): string {
  return needsQuotes(value) ? JSON.stringify(value) : value;
}

function needsQuotes(value: string): boolean {
	return !/^[A-Za-z0-9_.-]+$/.test(value);
}

function buildTrackCountFormula(trackProperty: string): string {
	if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(trackProperty)) {
		return `${trackProperty}.length`;
	}

	return `file.properties[${JSON.stringify(trackProperty)}].length`;
}
