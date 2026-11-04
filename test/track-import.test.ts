import { describe, expect, it } from 'vitest';
import { DEFAULT_PROPERTY_MAPPING } from '../src/domain/config';
import { buildMusicFrontmatter, classifyImport, isUnavailable, parseFlatPlaylistOutput, parseOembed, titleState, trackLabel } from '../src/domain/track-import';

describe('parseOembed', () => {
  it('reads title and author without the oEmbed thumbnail', () => {
    expect(parseOembed({ title: 'Song', author_name: 'Band', thumbnail_url: 'https://i/x.jpg' }))
      .toEqual({ title: 'Song', author: 'Band' });
  });

  it('defaults a missing author to empty', () => {
    expect(parseOembed({ title: 'Song' })).toEqual({ title: 'Song', author: '' });
  });

  it('rejects non-objects and missing titles', () => {
    expect(parseOembed(null)).toBeNull();
    expect(parseOembed('x')).toBeNull();
    expect(parseOembed({ author_name: 'Band' })).toBeNull();
  });
});

describe('trackLabel', () => {
  it('labels a bare-id track as unavailable and keeps real titles', () => {
    expect(trackLabel({ title: 'zzzzzzzzzz1', artist: '', videoId: 'zzzzzzzzzz1' })).toBe('Unavailable video');
    expect(trackLabel({ title: 'Song', artist: 'Band', videoId: 'zzzzzzzzzz1' })).toBe('Song');
    expect(trackLabel({ title: 'zzzzzzzzzz1', artist: '', videoId: 'zzzzzzzzzz1' }, true)).toBe('unavailable video');
  });
});

describe('buildMusicFrontmatter', () => {
  const meta = { videoId: 'Zs3CIgFET_Y', title: 'Song', author: 'Band' };

  it('uses the configured keys and the note type', () => {
    expect(buildMusicFrontmatter(meta, DEFAULT_PROPERTY_MAPPING)).toEqual({
      type: 'music',
      source: 'https://www.youtube.com/watch?v=Zs3CIgFET_Y',
      author: 'Band',
      image: 'https://i.ytimg.com/vi/Zs3CIgFET_Y/hqdefault.jpg',
    });
  });

  it('writes the thumbnail even when metadata is unavailable', () => {
    expect(buildMusicFrontmatter({ ...meta, title: meta.videoId, author: '' }, DEFAULT_PROPERTY_MAPPING).image)
      .toBe('https://i.ytimg.com/vi/Zs3CIgFET_Y/hqdefault.jpg');
  });

  it('omits the thumbnail key when the destination property is empty', () => {
    expect(buildMusicFrontmatter(meta, { ...DEFAULT_PROPERTY_MAPPING, musicThumbnailProperty: '' })).toEqual({
      type: 'music', source: 'https://www.youtube.com/watch?v=Zs3CIgFET_Y', author: 'Band',
    });
  });

  it.each(['', '   '])('omits empty destinations %j even with populated metadata', (property) => {
    expect(buildMusicFrontmatter(meta, {
      ...DEFAULT_PROPERTY_MAPPING,
      musicUrlProperty: property, musicArtistProperty: property, musicThumbnailProperty: property,
    })).toEqual({ type: 'music' });
  });

  it.each([
    { title: 'Song', author_name: 'Band', thumbnail_url: 'https://i.ytimg.com/vi/x/maxresdefault.jpg' },
    { title: 'Song', author_name: 'Band' },
  ])('writes the fixed thumbnail independently of oEmbed %j', (input) => {
    const parsed = parseOembed(input);
    expect(parsed).not.toBeNull();
    if (!parsed) throw new Error('Expected valid oEmbed metadata');
    expect(buildMusicFrontmatter({ videoId: meta.videoId, ...parsed }, {
      ...DEFAULT_PROPERTY_MAPPING, musicThumbnailProperty: 'poster',
    }).poster).toBe('https://i.ytimg.com/vi/Zs3CIgFET_Y/hqdefault.jpg');
  });

  it('honours custom mapping and omits an empty author', () => {
    const mapping = { ...DEFAULT_PROPERTY_MAPPING, musicNoteType: 'song', musicUrlProperty: 'yt' };
    expect(buildMusicFrontmatter({ ...meta, author: '' }, mapping)).toEqual({
      type: 'song',
      yt: 'https://www.youtube.com/watch?v=Zs3CIgFET_Y',
      image: 'https://i.ytimg.com/vi/Zs3CIgFET_Y/hqdefault.jpg',
    });
  });
});

describe('classifyImport', () => {
  const tracks = [{ path: 'a.md', videoId: 'Zs3CIgFET_Y' }];

  it('creates when unknown', () => {
    expect(classifyImport('DEyzYWLvXqA', tracks, [])).toEqual({ action: 'create' });
  });

  it('reuses a known note outside the playlist', () => {
    expect(classifyImport('Zs3CIgFET_Y', tracks, ['b.md'])).toEqual({ action: 'reuse', path: 'a.md' });
  });

  it('flags a track already in the playlist', () => {
    expect(classifyImport('Zs3CIgFET_Y', tracks, ['a.md'])).toEqual({ action: 'already-in-playlist', path: 'a.md' });
  });
});

describe('parseFlatPlaylistOutput', () => {
  it('parses rows, skipping blanks and invalid ids', () => {
    const out = [
      'Zs3CIgFET_Y\tFirst\tBand\tMy List',
      '',
      'bad\tNope\tx\tMy List',
      'DEyzYWLvXqA\tSecond\tNA\tMy List\r',
      'wOzHXgqNpe8\t\t\t',
    ].join('\n');
    expect(parseFlatPlaylistOutput(out)).toEqual({
      title: 'My List',
      entries: [
        { videoId: 'Zs3CIgFET_Y', title: 'First', author: 'Band' },
        { videoId: 'DEyzYWLvXqA', title: 'Second', author: '' },
        { videoId: 'wOzHXgqNpe8', title: 'wOzHXgqNpe8', author: '' },
      ],
    });
  });
});

describe('isUnavailable', () => {
  it('heals only a track still titled with its id and no artist', () => {
    expect(isUnavailable({ title: 'wOzHXgqNpe8', artist: '', videoId: 'wOzHXgqNpe8' })).toBe(true);
    expect(isUnavailable({ title: 'wOzHXgqNpe8', artist: 'Band', videoId: 'wOzHXgqNpe8' })).toBe(false);
    expect(isUnavailable({ title: 'Song', artist: '', videoId: 'wOzHXgqNpe8' })).toBe(false);
  });
});

describe('titleState', () => {
  const bare = { title: 'zzzzzzzzzz1', artist: '', videoId: 'zzzzzzzzzz1' };
  it('is loading only while a resolve or heal is in flight', () => {
    expect(titleState(bare, true)).toBe('loading');
    expect(titleState({ ...bare, title: 'Song' }, true)).toBe('ready');
  });

  it('is unavailable once the resolve ended without a title', () => {
    expect(titleState(bare, false)).toBe('unavailable');
  });

  it('is unavailable for a cached-audio track with no resolve pending', () => {
    expect(titleState({ ...bare }, false)).toBe('unavailable');
  });
});
