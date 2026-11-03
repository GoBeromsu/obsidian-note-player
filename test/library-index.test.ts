import { describe, expect, it } from 'vitest';
import { DEFAULT_PROPERTY_MAPPING } from '../src/domain/config';
import { buildMusicLibrary } from '../src/domain/library-index';
import type { MarkdownNoteSnapshot } from '../src/types/notes';

const videoId = 'DEyzYWLvXqA';
const source = `https://www.youtube.com/watch?v=${videoId}`;

function note(basename: string, overrides: Partial<MarkdownNoteSnapshot> = {}): MarkdownNoteSnapshot {
  return {
    path: `${basename}.md`, basename, ctime: 0, mtime: 0, frontmatterLinks: {}, embeddedBases: [],
    frontmatter: { type: 'music', source },
    ...overrides,
  };
}

function playlist(basename: string, overrides: Partial<MarkdownNoteSnapshot> = {}): MarkdownNoteSnapshot {
  return note(basename, {
    frontmatter: { type: 'music-playlist' }, embeddedBases: [`Bases/${basename}.base`], ...overrides,
  });
}

function library(notes: MarkdownNoteSnapshot[], baseConfigs = new Map<string, unknown>()) {
  return buildMusicLibrary(notes, DEFAULT_PROPERTY_MAPPING, baseConfigs);
}

describe('buildMusicLibrary', () => {
  it.each([
    { author: '[[Omoide Story - Topic]]', expected: 'Omoide Story - Topic' },
    { author: '[[path/X.md|Alias]]', expected: 'Alias' },
    { author: '[[path/X.md]]', expected: 'X' },
    { author: ['[[path/X|Alias]]', 'Band', '[[Music/Y.md]]'], expected: 'Alias, Band, Y' },
    { author: [null, '  ', 7], expected: '' },
  ])('displays author names instead of raw wikilinks: $author', ({ author, expected }) => {
    const result = library([note('Song', { frontmatter: { type: 'music', source, author } })]);
    expect(result.tracks[0]?.artist).toBe(expected);
  });
  it('groups resolved membership links including one track in two playlists', () => {
    const result = library([
      note('Beta', { frontmatterLinks: { playlists: ['First.md', 'Second.md', 'First.md'] } }),
      note('Alpha', { frontmatterLinks: { playlists: ['First.md'] } }),
      note('Other', { frontmatterLinks: { playlists: ['Journal.md'] } }),
      playlist('Second'), playlist('First'),
    ]);
    expect(result.playlists.map((entry) => ({ path: entry.path, base: entry.basePath, paths: entry.trackPaths }))).toEqual([
      { path: 'First.md', base: 'Bases/First.base', paths: ['Alpha.md', 'Beta.md'] },
      { path: 'Second.md', base: 'Bases/Second.base', paths: ['Beta.md'] },
    ]);
    expect(result.playlists[0]?.tracks.map((track) => track.path)).toEqual(['Alpha.md', 'Beta.md']);
  });

  it('requires the configured playlist type and an embedded base, never legacy tracks', () => {
    const result = library([
      note('Track', { frontmatterLinks: { playlists: ['No base.md', 'Legacy.md', 'Empty.md'] } }),
      playlist('No base', { embeddedBases: [] }),
      playlist('Legacy', { frontmatter: { type: 'playlist', tracks: ['Track.md'] } }),
      playlist('Empty', { frontmatter: { type: 'music-playlist', tracks: ['Track.md'] } }),
    ]);
    expect(result.playlists.map((entry) => entry.path)).toEqual(['Empty.md']);
    expect(library([note('Track'), playlist('Empty', {
      frontmatter: { type: 'music-playlist', tracks: ['Track.md'] },
    })]).playlists[0]?.trackPaths).toEqual([]);
  });

  it.each([
    { sort: [{ property: 'note.date_created', direction: 'DESC' }], expected: ['Beta.md', 'Gamma.md', 'Alpha.md'] },
    { sort: [{ property: 'file.mtime', direction: 'ASC' }], expected: ['Gamma.md', 'Alpha.md', 'Beta.md'] },
    { sort: [{ property: 'file.ctime', direction: 'DESC' }], expected: ['Gamma.md', 'Beta.md', 'Alpha.md'] },
    { sort: [{ property: 'formula.x', direction: 'DESC' }], expected: ['Alpha.md', 'Beta.md', 'Gamma.md'] },
    { sort: [], expected: ['Alpha.md', 'Beta.md', 'Gamma.md'] },
    { sort: [{ property: 'note.rank', direction: 'ASC' }, { property: 'file.mtime', direction: 'DESC' }],
      expected: ['Beta.md', 'Alpha.md', 'Gamma.md'] },
  ])('orders the membership queue using $sort', ({ sort, expected }) => {
    const tracks = [
      note('Alpha', { ctime: 10, mtime: 20, frontmatter: { type: 'music', source, date_created: '2026-01-01', rank: 1 } }),
      note('Beta', { ctime: 20, mtime: 30, frontmatter: { type: 'music', source, date_created: '2026-03-01', rank: 1 } }),
      note('Gamma', { ctime: 30, mtime: 10, frontmatter: { type: 'music', source, date_created: '2026-02-01', rank: 2 } }),
    ].map((track) => ({ ...track, frontmatterLinks: { playlists: ['Mix.md'] } }));
    const result = library([...tracks, playlist('Mix')], new Map([
      ['Bases/Mix.base', { views: [{ type: 'note-player', sort }] }],
    ]));
    expect(result.playlists[0]?.trackPaths).toEqual(expected);
  });

  it.each([null, 3, 'invalid', [], { views: 'invalid' }])('uses name order for malformed base config %j', (config) => {
    const result = library([
      note('Beta', { frontmatterLinks: { playlists: ['Mix.md'] } }),
      note('Alpha', { frontmatterLinks: { playlists: ['Mix.md'] } }),
      playlist('Mix'),
    ], new Map([['Bases/Mix.base', config]]));
    expect(result.playlists[0]?.trackPaths).toEqual(['Alpha.md', 'Beta.md']);
  });

  it('ignores string membership values and links to a non-playlist', () => {
    const malformedLinks: Record<string, string[]> = {};
    Object.defineProperty(malformedLinks, 'playlists', { value: 'Mix.md' });
    const invalid = note('Invalid', {
      frontmatter: { type: 'music', source, playlists: 'Mix.md' },
      frontmatterLinks: malformedLinks,
    });
    const result = library([
      invalid, note('Other', { frontmatterLinks: { playlists: ['Journal.md'] } }),
      note('Journal', { frontmatter: {} }), playlist('Mix'),
    ]);
    expect(result.playlists[0]?.tracks).toEqual([]);
  });

  it('ignores notes with missing, invalid or differently mapped URLs', () => {
    const result = library([
      note('Missing', { frontmatter: { type: 'music' } }),
      note('Invalid', { frontmatter: { type: 'music', source: 'https://example.com' } }),
      note('Other key', { frontmatter: { type: 'music', youtube: source } }),
    ]);
    expect(result.tracks).toEqual([]);
  });

  it('leaves artist empty and derives thumbnails without reading the image property', () => {
    const result = library([note('Song', { frontmatter: {
      type: 'music', source, artist: 'Other artist', image: 'https://example.com/custom.jpg',
    } })]);
    expect(result.tracks[0]?.artist).toBe('');
    expect(result.tracks[0]?.thumbnailUrl).toBe(`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`);
  });

  it('supports custom properties and note types without reading the defaults', () => {
    const mapping = { ...DEFAULT_PROPERTY_MAPPING, musicNoteType: 'song', playlistNoteType: 'mix',
      musicUrlProperty: 'clip', musicArtistProperty: 'performer', playlistMembershipProperty: 'mixes',
      playlistDescriptionProperty: 'summary', playlistCoverProperty: 'artwork' };
    const result = buildMusicLibrary([
      note('Song', { frontmatter: { type: 'song', clip: source, performer: 'Band' },
        frontmatterLinks: { mixes: ['Mix.md'] } }),
      playlist('Mix', { frontmatter: { type: 'mix', summary: 'Custom description', artwork: 'https://example.com/cover.jpg' } }),
    ], mapping, new Map());
    expect(result.tracks[0]?.artist).toBe('Band');
    expect(result.playlists[0]).toMatchObject({
      description: 'Custom description', coverUrl: 'https://example.com/cover.jpg', trackPaths: ['Song.md'],
    });
  });

  it('leaves thumbnails empty only for unavailable videos', () => {
    const result = library([
      note(videoId), note('Available', { frontmatter: { type: 'music', source, author: 'Band' } }),
    ]);
    expect(result.tracks.find((track) => track.title === videoId)?.thumbnailUrl).toBe('');
    expect(result.tracks.find((track) => track.title === 'Available')?.thumbnailUrl)
      .toBe(`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`);
  });

  it('reads metadata titles only for notes named after their video id', () => {
    const result = library([
      note(videoId, { frontmatter: { type: 'music', source, title: 'Healed title' } }),
      note('Other name', { frontmatter: { type: 'music', source, title: 'Ignored title' } }),
    ]);
    expect(result.tracks.map((track) => track.title)).toEqual(['Healed title', 'Other name']);
  });
});
