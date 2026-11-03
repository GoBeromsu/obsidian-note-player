import { App, Plugin } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings, normalizeSettingValue } from '../src/domain/config';
import { NotePlayerSettingsTab } from '../src/ui/settings';
import { convertPlaylistNotes } from '../src/services/playlist-migration-service';
import { flattenDefinitions, isControlRow, isRenderRow, renderRow } from './helpers/settings-render';

vi.mock('../src/services/playlist-migration-service', () => ({ convertPlaylistNotes: vi.fn(() => Promise.resolve()) }));

vi.mock('obsidian', () => ({
  App: class {},
  Plugin: class {},
  PluginSettingTab: class {
    constructor(public app: unknown) {}
  },
  FuzzySuggestModal: class {},
  renderResults: vi.fn(),
  setIcon: vi.fn(),
  // The assertions concern immediate settings state, not Obsidian's deferred persistence.
  debounce: (fn: () => void) => Object.assign(vi.fn(fn), { run: vi.fn() }),
}));

class SettingsHostStub extends Plugin {
  settings = { ...DEFAULT_SETTINGS };
  saveSettings = vi.fn(() => Promise.resolve());
  refresh = vi.fn(() => Promise.resolve());
  refreshCompanionBases = vi.fn(() => Promise.resolve());
  getThumbnailCache = vi.fn(() => null);
}

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

const manifest = {
  id: 'note-player',
  name: 'Note Player',
  version: '0.8.9',
  minAppVersion: '1.14.4',
  description: 'Settings test',
  author: 'Test',
};

function appWithFolders(paths: string[]): App {
  return Object.assign(new App(), { vault: { getAllFolders: () => paths.map((path) => ({ path })) } });
}

describe('settings definitions', () => {
  const app = appWithFolders(['Music/Sub', 'Inbox', 'Music']);
  const host = new SettingsHostStub(app, manifest);
  host.settings = { ...DEFAULT_SETTINGS, playlistFolder: 'Inbox', musicFolder: '' };
  const rows = flattenDefinitions(new NotePlayerSettingsTab(app, host).getSettingDefinitions());
  const controls = rows.filter(isControlRow).map((row) => row.control);

  it('opens the shared migration flow from the Companion Bases group', () => {
    const definitions = new NotePlayerSettingsTab(app, host).getSettingDefinitions();
    const group = definitions.find((item) => 'items' in item && 'heading' in item && item.heading === 'Companion Bases');
    if (!group || !('items' in group)) throw new Error('Missing companion group');
    vi.mocked(convertPlaylistNotes).mockClear();

    renderRow(group.items ?? [], 'Legacy playlist notes').click();

    expect(convertPlaylistNotes).toHaveBeenCalledTimes(1);
    expect(convertPlaylistNotes).toHaveBeenCalledWith(host);
  });

  it('fills the folder dropdowns in order from the vault root, surfacing the legacy empty value only where saved', () => {
    const playlist = renderRow(rows, 'Playlist folder');
    expect(playlist.added).toEqual([['/', 'Vault root'], ['Inbox', 'Inbox'], ['Music', 'Music'], ['Music/Sub', 'Music/Sub']]);
    expect(playlist.value).toBe('Inbox');
    const music = renderRow(rows, 'Music folder');
    expect(music.added.map(([value]) => value)).toEqual(['/', '', 'Inbox', 'Music', 'Music/Sub']);
    expect(music.added[1]).toEqual(['', 'Default location (legacy)']);
    expect(music.value).toBe('');
  });

  it('inserts integer-like folder names after the vault root in localeCompare order', () => {
    const numericApp = appWithFolders(['a', '2024', '10']);
    const numericHost = new SettingsHostStub(numericApp, manifest);
    numericHost.settings = { ...DEFAULT_SETTINGS, playlistFolder: '/' };
    const numericRows = flattenDefinitions(new NotePlayerSettingsTab(numericApp, numericHost).getSettingDefinitions());
    const { added, value } = renderRow(numericRows, 'Playlist folder');
    expect(added).toEqual([['/', 'Vault root'], ['10', '10'], ['2024', '2024'], ['a', 'a']]);
    expect(value).toBe('/');
  });

  it('offers and selects a folder named __proto__', () => {
    const protoApp = appWithFolders(['__proto__', 'Inbox']);
    const protoHost = new SettingsHostStub(protoApp, manifest);
    protoHost.settings = { ...DEFAULT_SETTINGS, playlistFolder: '__proto__' };
    const protoRows = flattenDefinitions(new NotePlayerSettingsTab(protoApp, protoHost).getSettingDefinitions());
    const { added, value } = renderRow(protoRows, 'Playlist folder');
    expect(added).toEqual([['/', 'Vault root'], ['__proto__', '__proto__'], ['Inbox', 'Inbox']]);
    expect(value).toBe('__proto__');
  });

  it('persists a folder pick through the settings normalizer', () => {
    const pickHost = new SettingsHostStub(app, manifest);
    pickHost.settings = { ...DEFAULT_SETTINGS, playlistFolder: 'Inbox' };
    const pickRows = flattenDefinitions(new NotePlayerSettingsTab(app, pickHost).getSettingDefinitions());
    renderRow(pickRows, 'Playlist folder').change('Music/Sub');
    expect(pickHost.settings.playlistFolder).toBe('Music/Sub');
  });

  it('reads the vault folders again on every render instead of caching them at definition time', () => {
    const folders = ['Inbox'];
    const liveApp = Object.assign(new App(), { vault: { getAllFolders: () => folders.map((path) => ({ path })) } });
    const liveHost = new SettingsHostStub(liveApp, manifest);
    liveHost.settings = { ...DEFAULT_SETTINGS, playlistFolder: 'Inbox' };
    const liveRows = flattenDefinitions(new NotePlayerSettingsTab(liveApp, liveHost).getSettingDefinitions());
    expect(renderRow(liveRows, 'Playlist folder').added.map(([value]) => value)).toEqual(['/', 'Inbox']);
    folders.push('New');
    expect(renderRow(liveRows, 'Playlist folder').added.map(([value]) => value)).toEqual(['/', 'Inbox', 'New']);
  });

  it('renders every mapping key through a picker row instead of a text or folder control', () => {
    expect(controls.filter((control) => control.type === 'text' || control.type === 'folder')).toEqual([]);
    const pickerRows = rows.filter(isRenderRow).filter((row) => typeof row.desc === 'string' && row.desc.includes('Default: '));
    expect(pickerRows.map((row) => row.name)).toEqual([
      'URL property',
      'Thumbnail property',
      'Artist property',
      'Membership property',
      'Description property',
      'Cover property',
      'Music note type',
      'Playlist note type',
    ]);
  });

});

describe('settings control value normalization', () => {
  it.each(Object.entries(defaults).flatMap(([key, expected]) =>
    ['', '  '].map((value) => ({ key, value, expected })),
  ))('stores $expected when the $key control is emptied', ({ key, value, expected }) => {
    const app = appWithFolders([]);
    const host = new SettingsHostStub(app, manifest);
    host.settings = { ...DEFAULT_SETTINGS, [key]: 'custom' };
    const tab = new NotePlayerSettingsTab(app, host);

    tab.setControlValue(key, value);

    expect(host.settings).toHaveProperty(key, expected);
  });

  it('keeps non-mapping controls independent of property defaults', () => {
    expect(normalizeSettingValue('musicFolder', '  ')).toBe('');
    expect(normalizeSettingValue('autoplayEnabled', false)).toBe(false);
  });
});
