import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings, normalizeSettingValue } from '../src/domain/config';

const defaults = {
  musicUrlProperty: 'source',
  musicThumbnailProperty: 'image',
  musicArtistProperty: 'author',
  playlistMembershipProperty: 'playlists',
  playlistDescriptionProperty: 'description',
  playlistCoverProperty: 'cover',
  musicNoteType: 'music',
  playlistNoteType: 'music-playlist',
};

describe('normalizeSettings', () => {
  it('initializes fresh settings with one property per role and no legacy track key', () => {
    const settings = normalizeSettings({});
    expect(settings).toEqual({ ...DEFAULT_SETTINGS, ...defaults });
    expect(settings).not.toHaveProperty('legacyPlaylistTrackProperty');
  });

  it.each([
    ['musicUrlProperties', 'musicUrlProperty'],
    ['musicThumbnailProperties', 'musicThumbnailProperty'],
    ['musicArtistProperties', 'musicArtistProperty'],
  ])('migrates the first non-empty string in %s to %s', (legacy, key) => {
    const settings = normalizeSettings({ [legacy]: ['', ' performer ', 'artist'] });
    expect(settings).toHaveProperty(key, 'performer');
    expect(settings).toHaveProperty('legacyPlaylistTrackProperty', 'tracks');
    expect(settings).not.toHaveProperty(legacy);
  });

  it.each([
    ['musicUrlProperties', 'musicUrlProperty', 'source'],
    ['musicThumbnailProperties', 'musicThumbnailProperty', 'image'],
    ['musicArtistProperties', 'musicArtistProperty', 'author'],
  ])('defaults an empty %s instead of retaining a list', (legacy, key, expected) => {
    expect(normalizeSettings({ [legacy]: ['', '  ', null, 42] })).toHaveProperty(key, expected);
  });

  it.each([
    ['custom', 'custom'],
    ['', 'author'],
    ['  ', 'author'],
    [42, 'author'],
  ])('gives the new key %j precedence over its legacy list', (value, expected) => {
    expect(normalizeSettings({
      musicArtistProperty: value,
      musicArtistProperties: ['performer'],
    }).musicArtistProperty).toBe(expected);
  });

  it.each(Object.entries(defaults).flatMap(([key, expected]) =>
    ['', '  ', 42, null].map((value) => ({ key, value, expected })),
  ))('restores $key from saved $value to $expected', ({ key, value, expected }) => {
    expect(normalizeSettings({ [key]: value })).toHaveProperty(key, expected);
  });

  it.each(Object.keys(defaults))('trims and retains a configured %s', (key) => {
    expect(normalizeSettings({ [key]: ' custom ' })).toHaveProperty(key, 'custom');
  });

  it.each([
    [{ musicArtistProperties: 'author' }, 'musicArtistProperty', 'author'],
    [{ musicUrlProperties: null }, 'musicUrlProperty', 'source'],
    [{ musicUrlProperty: 42 }, 'musicUrlProperty', 'source'],
  ])('handles malformed mapping input %j without throwing', (input, key, expected) => {
    expect(normalizeSettings(input)).toHaveProperty(key, expected);
  });

  it('preserves the legacy playlist property only under the migration key', () => {
    const settings = normalizeSettings({ playlistTrackProperty: ' songs ' });
    expect(settings.legacyPlaylistTrackProperty).toBe('songs');
    expect(settings).not.toHaveProperty('playlistTrackProperty');
  });

  it('preserves unrelated settings and remains stable when normalized again', () => {
    const settings = normalizeSettings({
      playlistTrackProperty: 'songs',
      musicArtistProperties: ['performer'],
      musicFolder: 'Music',
      autoplayEnabled: false,
      volume: 0.4,
    });
    expect(settings).toMatchObject({ musicFolder: 'Music', autoplayEnabled: false, volume: 0.4 });
    expect(normalizeSettings(settings)).toEqual(settings);
  });

  it('migrates the Ataraxia data.json shape without retaining legacy keys', () => {
    const settings = normalizeSettings({
      musicUrlProperties: ['source', 'youtube', 'youtube_url', 'url'],
      musicThumbnailProperties: ['image', 'thumbnail', 'cover'],
      musicArtistProperties: ['author', 'artist'],
      playlistTrackProperty: 'tracks',
      playlistFolder: '70. Collections/04 Music',
      musicFolder: '',
      musicNoteType: 'music',
      playlistNoteType: 'music-playlist',
    });
    expect(settings).toMatchObject({
      ...defaults,
      legacyPlaylistTrackProperty: 'tracks',
      playlistFolder: '70. Collections/04 Music',
      musicFolder: '',
    });
    for (const key of ['musicUrlProperties', 'musicThumbnailProperties', 'musicArtistProperties', 'playlistTrackProperty']) {
      expect(settings).not.toHaveProperty(key);
    }
  });
});

describe('settings control value normalization', () => {
  it.each(Object.entries(defaults).flatMap(([key, expected]) =>
    ['', '  '].map((value) => ({ key, value, expected })),
  ))('stores $expected when the $key control is emptied', ({ key, value, expected }) => {
    const settings = { ...DEFAULT_SETTINGS };
    Object.assign(settings, { [key]: normalizeSettingValue(key, value) });
    expect(settings).toHaveProperty(key, expected);
  });

  it('keeps non-mapping controls independent of property defaults', () => {
    expect(normalizeSettingValue('musicFolder', '  ')).toBe('');
    expect(normalizeSettingValue('autoplayEnabled', false)).toBe(false);
  });
});
