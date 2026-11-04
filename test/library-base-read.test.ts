import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, type PluginManifest } from 'obsidian';
import { DEFAULT_SETTINGS } from '../src/domain/config';
import NotePlayerPlugin from '../src/main';
import { state } from './helpers/migration-obsidian';

vi.mock('obsidian', async () => {
  const boundary = await import('./helpers/migration-obsidian');
  return {
    ...boundary,
    Plugin: class extends boundary.Component {
      constructor(readonly app: App, readonly manifest: PluginManifest) { super(); }
      saveData() { return Promise.resolve(); }
    },
    debounce: (callback: () => void) => Object.assign(callback, { cancel() {} }),
  };
});
vi.mock('../src/ui/settings', () => ({ NotePlayerSettingsTab: class {} }));
vi.mock('../src/ui/commands', () => ({ registerCommands: vi.fn() }));
vi.mock('../src/services/playlist-migration-service', () => ({ convertPlaylistNotes: vi.fn() }));
vi.mock('../src/ui/player-setup', () => ({ createPlayer: vi.fn() }));
vi.mock('../src/ui/views/NotePlayerView', () => ({
  NotePlayerView: class {},
  VIEW_TYPE_NOTE_PLAYER: 'obsidian-note-player-view',
  VIEW_TYPE_LEGACY: 'youtube-note-playlist-view',
}));

afterEach(() => { vi.restoreAllMocks(); });

describe('library base read isolation', () => {
  it('loads both playlists and all tracks after a paired base is deleted during read, warning once across refreshes', async () => {
    const app = new App();
    for (const name of ['Deleted', 'Good']) {
      await app.vault.create(`${name}.base`,
        'views:\n  - type: cards\n    sort:\n      - property: file.name\n        direction: DESC\n');
      await app.vault.create(`${name}.md`,
        `---\n{"type":"music-playlist"}\n---\n![[${name}.base]]\n`);
    }
    for (const name of ['Z', 'A']) {
      await app.vault.create(`${name}.md`,
        `---\n${JSON.stringify({ type: 'music', source: 'https://youtu.be/dQw4w9WgXcQ', playlists: ['[[Deleted]]', '[[Good]]'] })}\n---\n`);
    }
    const plugin = new NotePlayerPlugin(app, {
      id: 'note-player', name: 'Note Player', version: '0.8.9',
      minAppVersion: '1.13.0', description: '', author: '',
    });
    plugin.settings = { ...DEFAULT_SETTINGS, musicFolder: '/', playlistFolder: '/', lastPlaylistPath: 'Deleted.md' };
    const failure = Object.assign(new Error('ENOENT: Deleted.base was deleted after lookup'), { code: 'ENOENT' });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const read = app.vault.cachedRead.bind(app.vault);
    const fake = state(app);
    vi.spyOn(app.vault, 'cachedRead').mockImplementation((file) => {
      if (file.path === 'Deleted.base') {
        fake.files.delete(file.path);
        fake.contents.delete(file.path);
        return Promise.reject(failure);
      }
      return read(file);
    });

    for (let refresh = 0; refresh < 2; refresh++) {
      // Restore discovery so the same post-lookup read race recurs deterministically.
      if (refresh) await app.vault.create('Deleted.base', 'views: []\n');
      await plugin.refresh();
      const result = plugin.getState();
      expect(result.library.map((track) => track.path)).toEqual(['A.md', 'Z.md']);
      expect(result.playlists.map((playlist) => playlist.path)).toEqual(['Deleted.md', 'Good.md']);
      expect(result.queue.map((track) => track.path)).toEqual(['A.md', 'Z.md']);
      expect(result.errorMessage).toBeNull();
      await plugin.selectPlaylist('Good.md');
      expect(plugin.getState().queue.map((track) => track.path)).toEqual(['Z.md', 'A.md']);
      await plugin.selectPlaylist('Deleted.md');
    }
    expect(warning).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining('Deleted.base'), failure,
    );
    expect(error).not.toHaveBeenCalled();
  });
});
