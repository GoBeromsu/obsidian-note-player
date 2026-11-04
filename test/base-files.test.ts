import { describe, expect, it } from 'vitest';
import {
  buildCompanionBaseFiles, createMusicBaseContent, createPlaylistBaseContent,
  createPlaylistsOverviewContent, getCompanionBaseFolder,
} from '../src/domain/base-files';
import { DEFAULT_PROPERTY_MAPPING } from '../src/domain/config';
import { parse } from 'yaml';

describe('companion base files', () => {
  it('places base files beside the playlist folder by default', () => {
    expect(getCompanionBaseFolder('90. System/Playlists')).toBe('90. System');
    expect(getCompanionBaseFolder('Playlists')).toBe('Playlists');
  });

  it('builds deterministic base files from configured property mapping', () => {
    const files = buildCompanionBaseFiles('90. System/Playlists', {
      musicUrlProperty: 'clip_url',
      musicThumbnailProperty: 'poster',
      musicArtistProperty: 'performer',
      playlistMembershipProperty: 'playlists',
      legacyPlaylistTrackProperty: 'entries',
      playlistDescriptionProperty: 'summary',
      playlistCoverProperty: 'artwork',
      musicNoteType: 'music',
      playlistNoteType: 'music-playlist',
    });

    expect(files).toEqual([
      expect.objectContaining({
        path: '90. System/Music.base',
      }),
      expect.objectContaining({
        path: '90. System/Playlists.base',
      }),
    ]);
	expect(files[0]?.content).toContain('- poster');
	expect(files[0]?.content).toContain('- performer');
	expect(files[0]?.content).toContain('- clip_url');
	expect(files[0]?.content).toContain('name: "Table"');
	expect(files[1]?.content).not.toContain('- entries');
	expect(files[1]?.content).toContain('- summary');
	expect(files[1]?.content).toContain('- artwork');
	expect(files[1]?.content).not.toContain('formulas:');
	expect(files[1]?.content).toContain('name: "Cards"');
  });
});

describe('playlist base content', () => {
  it.each([
    ['playlists', 'list(playlists).contains(this)'],
    ['my prop', 'list(note["my prop"]).contains(this)'],
    ['my "odd" prop', 'list(note["my \\"odd\\" prop"]).contains(this)'],
    ['back\\slash', 'list(note["back\\\\slash"]).contains(this)'],
    ['mood: calm', 'list(note["mood: calm"]).contains(this)'],
    ['#mood', 'list(note["#mood"]).contains(this)'],
    ['노동요', 'list(note["노동요"]).contains(this)'],
  ])('serializes the membership expression for %s', (property, expression) => {
    const content = createPlaylistBaseContent({
      ...DEFAULT_PROPERTY_MAPPING, playlistMembershipProperty: property,
    });

    expect(content.split('\n')).toEqual([
      'filters:',
      '  and:',
      '    - "type == \\"music\\""',
      `    - ${JSON.stringify(expression)}`,
      'views:',
      '  - type: cards',
      '    name: "Cards"',
      '    image: note.image',
      '    imageFit: ""',
      '    imageAspectRatio: 0.5625',
      '    sort:',
      '      - property: file.name',
      '        direction: ASC',
      '    order:',
      '      - file.name',
      '      - note.author',
      '  - type: table',
      '    name: "Table"',
      '    order:',
      '      - file.name',
      '      - author',
      '      - source',
      'properties:',
      '  file.name:',
      '    displayName: "Title"',
      '  note.author:',
      '    displayName: "Artist"',
      '',
    ]);
  });

  it('binds native cards to the configured image and author properties', () => {
    const content = createPlaylistBaseContent({
      ...DEFAULT_PROPERTY_MAPPING, musicThumbnailProperty: 'album art', musicArtistProperty: 'performer',
    });
    expect(parse(content)).toMatchObject({
      properties: {
        'file.name': { displayName: 'Title' },
        'note.performer': { displayName: 'Artist' },
      },
      views: [
        { type: 'cards', image: 'note.album art', order: ['file.name', 'note.performer'],
          imageFit: '', imageAspectRatio: 0.5625,
          sort: [{ property: 'file.name', direction: 'ASC' }] },
        { type: 'table' },
      ],
    });
  });

  it.each([createMusicBaseContent, createPlaylistBaseContent, createPlaylistsOverviewContent])(
    'escapes configured note types in filters',
    (build) => {
      const content = build({
        ...DEFAULT_PROPERTY_MAPPING,
        musicNoteType: 'my "music"\\type: #노동요',
        playlistNoteType: 'my "playlist"\\type: #노동요',
      });
      const type = build === createPlaylistsOverviewContent ? 'playlist' : 'music';
      const filter = content.split('\n')[2]?.trim().slice(2);

      expect(filter && JSON.parse(filter)).toBe(`type == "my \\"${type}\\"\\\\type: #노동요"`);
    },
  );

  it('omits empty optional columns without substituting defaults', () => {
    const content = createPlaylistBaseContent({ ...DEFAULT_PROPERTY_MAPPING, musicArtistProperty: '' });

    expect(content.split('\n').filter((line) => /^ {6}- (?!property:)/.test(line))).toEqual([
      '      - file.name', '      - file.name', '      - source',
    ]);
  });

  it.each([createMusicBaseContent, createPlaylistsOverviewContent])(
    'omits empty configured columns from companion bases',
    (build) => {
      const content = build({
        ...DEFAULT_PROPERTY_MAPPING, musicArtistProperty: '', musicUrlProperty: '',
        musicThumbnailProperty: '', playlistDescriptionProperty: '', playlistCoverProperty: '',
      });

      expect(content.split('\n').filter((line) => line.startsWith('      - '))).toEqual(
        build === createMusicBaseContent
          ? ['      - file.name', '      - file.name', '      - file.folder', '      - file.mtime']
          : ['      - file.name', '      - file.name'],
      );
    },
  );

  it.each(['my "odd" prop', 'back\\slash', 'mood: calm', '#mood', '노동요', 'null', '123'])(
    'quotes YAML column keys and values for %s',
    (property) => {
      const content = createMusicBaseContent({
        ...DEFAULT_PROPERTY_MAPPING, musicArtistProperty: property,
      });

      expect(content.split('\n')).toContain(`      - ${JSON.stringify(property)}`);
      expect(content.split('\n')).toContain(`  ${JSON.stringify(property)}:`);
    },
  );
});
