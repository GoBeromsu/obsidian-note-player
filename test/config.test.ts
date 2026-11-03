import {
  App,
  Plugin,
  TFolder,
  type SettingDefinitionControl,
  type SettingDefinitionItem,
  type SettingDefinitionRender,
  type SettingGroupItem,
} from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings, normalizeSettingValue } from '../src/domain/config';
import { NotePlayerSettingsTab } from '../src/ui/settings';

vi.mock('obsidian', () => ({
  App: class {},
  Plugin: class {},
  PluginSettingTab: class {
    constructor(public app: unknown) {}
    update = vi.fn();
  },
  FuzzySuggestModal: class {},
  TFolder: class {},
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
  registerEvent = vi.fn();
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

type VaultListener = (file: unknown) => void;

function appWithFolders(paths: string[]): App & { listeners: Record<string, VaultListener> } {
  const listeners: Record<string, VaultListener> = {};
  return Object.assign(new App(), {
    listeners,
    workspace: { onLayoutReady: (cb: () => void) => cb() },
    vault: {
      getAllFolders: () => paths.map((path) => ({ path })),
      on: (name: string, cb: VaultListener) => { listeners[name] = cb; return { name }; },
    },
  });
}

type Row = SettingDefinitionItem | SettingGroupItem;

function flattenDefinitions(items: SettingDefinitionItem[]): Row[] {
  return items.flatMap((item): Row[] => ('items' in item ? item.items ?? [] : [item]));
}

const isControlRow = (row: Row): row is SettingDefinitionControl => 'control' in row && row.control !== undefined;
const isRenderRow = (row: Row): row is SettingDefinitionRender => 'render' in row && typeof row.render === 'function';

describe('settings definitions', () => {
  const app = appWithFolders(['Music/Sub', 'Inbox', 'Music']);
  const host = new SettingsHostStub(app, manifest);
  host.settings = { ...DEFAULT_SETTINGS, playlistFolder: 'Inbox', musicFolder: '' };
  const rows = flattenDefinitions(new NotePlayerSettingsTab(app, host).getSettingDefinitions());
  const controls = rows.filter(isControlRow).map((row) => row.control);
  const dropdownOptions = (key: string) => {
    const control = controls.find((candidate) => candidate.key === key);
    return control?.type === 'dropdown' ? control.options : null;
  };

  it('offers folders as dropdowns rooted at the vault root, surfacing the legacy empty value only where saved', () => {
    const options = dropdownOptions('playlistFolder');
    expect(Object.keys(options ?? {})).toEqual(['/', 'Inbox', 'Music', 'Music/Sub']);
    expect(options?.['/']).toBe('Vault root');
    const music = dropdownOptions('musicFolder');
    expect(Object.keys(music ?? {})).toEqual(['/', '', 'Inbox', 'Music', 'Music/Sub']);
    expect(music?.['']).toBe('Default location (legacy)');
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

  it('refreshes the cached definitions when a vault folder changes, ignoring files', () => {
    const folderApp = appWithFolders(['Inbox']);
    const folderHost = new SettingsHostStub(folderApp, manifest);
    const tab = new NotePlayerSettingsTab(folderApp, folderHost);
    expect(Object.keys(folderApp.listeners).sort()).toEqual(['create', 'delete', 'rename']);
    expect(folderHost.registerEvent).toHaveBeenCalledTimes(3);
    folderApp.listeners.create?.({ path: 'note.md' });
    expect(tab.update).not.toHaveBeenCalled();
    folderApp.listeners.create?.(new TFolder());
    folderApp.listeners.rename?.(new TFolder());
    expect(tab.update).toHaveBeenCalledTimes(2);
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
