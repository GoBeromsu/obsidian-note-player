import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, Plugin } from 'obsidian';
import { DEFAULT_PROPERTY_MAPPING, DEFAULT_SETTINGS } from '../src/domain/config';
import { NotePlayerSettingsTab } from '../src/ui/settings';

vi.mock('obsidian', () => ({
  App: class {},
  Plugin: class { constructor(readonly app: App) {} },
  PluginSettingTab: class { hide() {} },
  FuzzySuggestModal: class {},
  debounce: (callback: () => void) => Object.assign(() => {}, { run: callback }),
}));
vi.mock('../src/services/playlist-migration-service', () => ({ convertPlaylistNotes: vi.fn() }));

afterEach(() => vi.restoreAllMocks());

function setup() {
  class SettingsPlugin extends Plugin {}
  const host = Object.assign(new SettingsPlugin(new App(), {
    id: 'note-player', name: 'Note Player', version: '0.8.9',
    minAppVersion: '1.13.0', description: '', author: '',
  }), {
    settings: { ...DEFAULT_SETTINGS },
    saveSettings: () => Promise.resolve(),
    refresh: () => Promise.resolve(),
    refreshCompanionBases: () => Promise.resolve(),
    getThumbnailCache: () => null,
  });
  return { host, tab: new NotePlayerSettingsTab(host.app, host) };
}

describe('library settings', () => {
  it.each(['musicFolder', 'playlistFolder', ...Object.keys(DEFAULT_PROPERTY_MAPPING)])(
    'refreshes discovery after changing %s and closing settings',
    async (key) => {
      const { host, tab } = setup();
      let refreshed: () => void = () => {};
      const published = new Promise<void>((resolve) => { refreshed = resolve; });
      vi.spyOn(host, 'refresh').mockImplementation(() => { refreshed(); return Promise.resolve(); });

      tab.setControlValue(key, 'New value');
      tab.hide();
      await host.saveSettings();

      expect(host.refresh).toHaveBeenCalledOnce();
      await published;
    },
  );

  it('keeps the thumbnail cache at the bottom of settings', () => {
    const { tab } = setup();
    const last = tab.getSettingDefinitions().at(-1);
    if (!last || !('items' in last) || !last.items) throw new Error('Missing last settings group');

    expect(last.items.map((item) => ('name' in item ? item.name : ''))).toEqual(['Thumbnail cache']);
  });

  it('describes playlist folder discovery and creation together', () => {
    const { tab } = setup();
    const library = tab.getSettingDefinitions().find((item) => 'heading' in item && item.heading === 'Library');
    if (!library || !('items' in library) || !library.items) throw new Error('Missing library settings');
    const folder = library.items.find((item) => 'name' in item && item.name === 'Playlist folder');

    expect(folder && 'desc' in folder ? folder.desc : undefined).toBe('Playlists are read from this folder and its subfolders, and new playlists are created here. Default: 90. System/Playlists.');
  });
});
