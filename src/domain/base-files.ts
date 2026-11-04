import type { YoutubePlaylistPropertyMapping } from '../types/settings';

export const MUSIC_BASE_NAME = 'Music.base';
export const PLAYLISTS_BASE_NAME = 'Playlists.base';

export interface CompanionBaseFile {
  path: string;
  content: string;
}

export function buildCompanionBaseFiles(
  playlistFolder: string,
  propertyMapping: YoutubePlaylistPropertyMapping,
): CompanionBaseFile[] {
  const folder = getCompanionBaseFolder(playlistFolder);

  return [
    {
      path: joinVaultPath(folder, MUSIC_BASE_NAME),
      content: createMusicBaseContent(propertyMapping),
    },
    {
      path: joinVaultPath(folder, PLAYLISTS_BASE_NAME),
      content: createPlaylistsOverviewContent(propertyMapping),
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

export function createMusicBaseContent(propertyMapping: YoutubePlaylistPropertyMapping): string {
	const artistProperty = propertyMapping.musicArtistProperty;
	const thumbnailProperty = propertyMapping.musicThumbnailProperty;
  const urlProperty = propertyMapping.musicUrlProperty;

	return [
		'filters:',
		'  and:',
		`    - ${JSON.stringify(`type == ${JSON.stringify(propertyMapping.musicNoteType)}`)}`,
		'views:',
		'  - type: cards',
		'    name: "Library"',
		'    order:',
		'      - file.name',
		...[artistProperty, thumbnailProperty, urlProperty].filter(Boolean).map((property) => `      - ${serializeValue(property)}`),
		'  - type: table',
		'    name: "Table"',
		'    order:',
		'      - file.name',
		...[artistProperty, urlProperty].filter(Boolean).map((property) => `      - ${serializeValue(property)}`),
		'      - file.folder',
		'      - file.mtime',
		'properties:',
		...(thumbnailProperty ? [`  ${serializeKey(thumbnailProperty)}:`, '    displayName: "Thumbnail"'] : []),
		...(artistProperty ? [`  ${serializeKey(artistProperty)}:`, '    displayName: "Artist"'] : []),
		...(urlProperty ? [`  ${serializeKey(urlProperty)}:`, '    displayName: "YouTube URL"'] : []),
    '',
  ].join('\n');
}

export function createPlaylistsOverviewContent(propertyMapping: YoutubePlaylistPropertyMapping): string {
	const descriptionProperty = propertyMapping.playlistDescriptionProperty;
	const coverProperty = propertyMapping.playlistCoverProperty;

	return [
		'filters:',
		'  and:',
		`    - ${JSON.stringify(`type == ${JSON.stringify(propertyMapping.playlistNoteType)}`)}`,
		'views:',
		'  - type: table',
		'    name: "Playlists"',
		'    order:',
		'      - file.name',
		...[descriptionProperty, coverProperty].filter(Boolean).map((property) => `      - ${serializeValue(property)}`),
		'  - type: cards',
		'    name: "Cards"',
		'    order:',
		'      - file.name',
		...[coverProperty, descriptionProperty].filter(Boolean).map((property) => `      - ${serializeValue(property)}`),
		'properties:',
		...(descriptionProperty ? [`  ${serializeKey(descriptionProperty)}:`, '    displayName: "Description"'] : []),
		...(coverProperty ? [`  ${serializeKey(coverProperty)}:`, '    displayName: "Cover"'] : []),
		'',
	].join('\n');
}

export function createPlaylistBaseContent(mapping: YoutubePlaylistPropertyMapping): string {
	const membership = /^[A-Za-z_][A-Za-z0-9_]*$/.test(mapping.playlistMembershipProperty)
		? mapping.playlistMembershipProperty
		: `note[${JSON.stringify(mapping.playlistMembershipProperty)}]`;
	return [
		'filters:',
		'  and:',
		`    - ${JSON.stringify(`type == ${JSON.stringify(mapping.musicNoteType)}`)}`,
		`    - ${JSON.stringify(`list(${membership}).contains(this)`)}`,
		'views:',
		'  - type: cards',
		'    name: "Cards"',
		`    image: ${serializeValue(`note.${mapping.musicThumbnailProperty}`)}`,
		'    imageFit: ""',
		'    imageAspectRatio: 0.5625',
		'    sort:',
		'      - property: file.name',
		'        direction: ASC',
		'    order:',
		'      - file.name',
		...(mapping.musicArtistProperty ? [`      - ${serializeValue(`note.${mapping.musicArtistProperty}`)}`] : []),
		'  - type: table',
		'    name: "Table"',
		'    order:',
		'      - file.name',
		...[mapping.musicArtistProperty, mapping.musicUrlProperty].filter(Boolean).map((property) => `      - ${serializeValue(property)}`),
		'properties:',
		'  file.name:',
		'    displayName: "Title"',
		...(mapping.musicArtistProperty ? [`  ${serializeKey(`note.${mapping.musicArtistProperty}`)}:`, '    displayName: "Artist"'] : []),
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
	return !/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(value) || /^(true|false|null|yes|no|on|off)$/i.test(value);
}
