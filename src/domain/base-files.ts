import type { YoutubePlaylistPropertyMapping } from '../types/settings';
import { DEFAULT_PROPERTY_MAPPING } from './config';

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
	const artistProperty = firstProperty(propertyMapping.musicArtistProperties, DEFAULT_PROPERTY_MAPPING.musicArtistProperties[0]!);
	const thumbnailProperty = firstProperty(
		propertyMapping.musicThumbnailProperties,
		DEFAULT_PROPERTY_MAPPING.musicThumbnailProperties[0]!,
  );
  const urlProperty = firstProperty(propertyMapping.musicUrlProperties, DEFAULT_PROPERTY_MAPPING.musicUrlProperties[0]!);

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
	const trackProperty = propertyMapping.playlistTrackProperty || DEFAULT_PROPERTY_MAPPING.playlistTrackProperty;
	const descriptionProperty =
		propertyMapping.playlistDescriptionProperty || DEFAULT_PROPERTY_MAPPING.playlistDescriptionProperty;
	const coverProperty = propertyMapping.playlistCoverProperty || DEFAULT_PROPERTY_MAPPING.playlistCoverProperty;
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

function firstProperty(values: string[], fallback: string): string {
  return values.find((value) => value.trim().length > 0) ?? fallback;
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
