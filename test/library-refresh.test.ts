import { describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian';
import NotePlayerPlugin from '../src/main';
import { DEFAULT_SETTINGS } from '../src/domain/config';
import { collectBaseConfigs, collectNoteSnapshots } from '../src/services/vault-io';
import type { MarkdownNoteSnapshot } from '../src/types/notes';

const vaultEvents = vi.hoisted(() => ({
  rename: (_file: { path: string }, _oldPath: string) => {},
}));

vi.mock('obsidian', () => ({
  App: class {
    vault = {
      adapter: {},
      on: (event: string, callback: typeof vaultEvents.rename) => {
        if (event === 'rename') vaultEvents.rename = callback;
        return {};
      },
    };
    metadataCache = { on: () => ({}) };
    workspace = { layoutReady: true };
  },
  Notice: class {},
  Plugin: class {
    constructor(readonly app: App) {}
    saveData() { return Promise.resolve(); }
    loadData() {
      return Promise.resolve({
        musicFolder: 'Music', playlistFolder: 'Playlists',
        lastPlaylistPath: 'Mix.md', autoOpenOnStartup: false,
      });
    }
    registerEvent() {}
    registerView() {}
    registerBasesView() { return true; }
    addRibbonIcon() {}
    addSettingTab() {}
  },
  debounce: (callback: () => void) => callback,
}));
vi.mock('../src/services/vault-io', () => ({
  collectNoteSnapshots: vi.fn(),
  collectBaseConfigs: vi.fn(),
}));
vi.mock('../src/ui/settings', () => ({ NotePlayerSettingsTab: class {} }));
vi.mock('../src/ui/commands', () => ({ registerCommands: vi.fn() }));
vi.mock('../src/services/playlist-migration-service', () => ({ convertPlaylistNotes: vi.fn(() => Promise.resolve()) }));
vi.mock('../src/ui/player-setup', () => ({
  createPlayer: () => ({
    surface: { setRepeatMode: () => {}, setAudioCacheService: () => {} },
    statusBar: { setNowPlaying: () => {} },
  }),
}));
vi.mock('../src/services/thumbnail-cache', () => ({
  ThumbnailCacheService: { attach: () => null },
}));
vi.mock('../src/ui/views/NotePlayerView', () => ({
  NotePlayerView: class {},
  VIEW_TYPE_NOTE_PLAYER: 'obsidian-note-player-view',
  VIEW_TYPE_LEGACY: 'youtube-note-playlist-view',
}));
vi.mock('../src/ui/views/PlaylistBasesView', () => ({
  PlaylistBasesView: class {},
  PLAYLIST_BASES_VIEW_TYPE: 'note-player',
}));

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: Error): void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<T>((complete, fail) => { resolve = complete; reject = fail; });
  return { promise, resolve, reject };
}

function snapshots(members: string[]): MarkdownNoteSnapshot[] {
  return [{
    path: 'Mix.md', basename: 'Mix', ctime: 1, mtime: 1,
    frontmatter: { type: 'music-playlist' },
    frontmatterLinks: {}, embeddedBases: ['Mix.base'],
  }, {
    path: 'Song.md', basename: 'Song', ctime: 1, mtime: 1,
    frontmatter: { type: 'music', source: 'https://youtu.be/dQw4w9WgXcQ' },
    frontmatterLinks: { playlists: members }, embeddedBases: [],
  }];
}

describe('library refresh ordering', () => {
  it('keeps the selected playlist, queue and current track after its note is renamed', async () => {
    const plugin = new NotePlayerPlugin(new App(), {
      id: 'note-player', name: 'Note Player', version: '0.8.9',
      minAppVersion: '1.13.0', description: '', author: '',
    });
    const [mix, song] = snapshots(['Mix.md']);
    if (!mix || !song) throw new Error('Missing playlist fixture');
    const other = { ...mix, path: 'Another.md', basename: 'Another', embeddedBases: ['Another.base'] };
    vi.mocked(collectNoteSnapshots).mockReturnValue([other, mix, song]);
    vi.mocked(collectBaseConfigs).mockResolvedValue(new Map());
    await plugin.onload();
    await plugin.playTrack('Song.md');
    const before = plugin.getState();
    const save = vi.spyOn(plugin, 'saveData');
    vi.mocked(collectNoteSnapshots).mockReturnValue([
      other,
      { ...mix, path: 'Renamed.md', basename: 'Renamed' },
      { ...song, frontmatterLinks: { playlists: ['Renamed.md'] } },
    ]);

    vaultEvents.rename({ path: 'Renamed.md' }, 'Mix.md');
    await plugin.refresh();

    expect(plugin.getState().selectedPlaylistPath).toBe('Renamed.md');
    expect(plugin.settings.lastPlaylistPath).toBe('Renamed.md');
    expect(plugin.getState().queue).toEqual(before.queue);
    expect(plugin.getState().currentTrack).toEqual(before.currentTrack);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ lastPlaylistPath: 'Renamed.md' }));
  });

  it.each([
    ['Other.md', 'Other song.md'],
    ['Mix.md', 'Song.md'],
    ['Empty.md', 'Song.md'],
  ])('plays within selected playlist %s rather than the remembered queue', async (selected, expected) => {
    const plugin = new NotePlayerPlugin(new App(), {
      id: 'note-player', name: 'Note Player', version: '0.8.9',
      minAppVersion: '1.13.0', description: '', author: '',
    });
    plugin.settings = { ...DEFAULT_SETTINGS, lastPlaylistPath: 'Mix.md' };
    const [mix, song] = snapshots([]);
    if (!mix || !song) throw new Error('Missing playlist fixture');
    vi.mocked(collectNoteSnapshots).mockReturnValue([
      ...snapshots(['Mix.md']),
      { ...mix, path: 'Other.md', basename: 'Other', embeddedBases: ['Other.base'] },
      { ...mix, path: 'Empty.md', basename: 'Empty', embeddedBases: ['Empty.base'] },
      { ...song, path: 'Earlier song.md', basename: 'Earlier song', frontmatterLinks: { playlists: ['Mix.md'] } },
      { ...song, path: 'Other song.md', basename: 'Other song', frontmatterLinks: { playlists: ['Other.md'] } },
    ]);
    vi.mocked(collectBaseConfigs).mockResolvedValue(new Map());
    await plugin.refresh();
    await plugin.playTrack('Song.md');
    await plugin.selectPlaylist(selected);
    const play = vi.spyOn(plugin, 'playTrack');

    await plugin.togglePlayback();

    expect(plugin.getState().currentTrack?.path).toBe(expected);
    if (selected === 'Empty.md') {
      expect(play).not.toHaveBeenCalled();
    } else {
      expect(plugin.getState().queue.map((track) => track.path)).toContain(plugin.getState().currentTrack?.path);
    }
  });

  it.each([
    {
      result: 'empty membership',
      settle: (pending: Deferred<Map<string, unknown>>) => pending.resolve(new Map()),
    },
    {
      result: 'read error',
      settle: (pending: Deferred<Map<string, unknown>>) => pending.reject(new Error('Older base read failed')),
    },
  ])('does not publish an older slow $result after a newer refresh commits', async ({ settle }) => {
    const plugin = new NotePlayerPlugin(new App(), {
      id: 'note-player', name: 'Note Player', version: '0.8.9',
      minAppVersion: '1.13.0', description: '', author: '',
    });
    plugin.settings = { ...DEFAULT_SETTINGS, lastPlaylistPath: 'Mix.md' };
    const olderRead = deferred<Map<string, unknown>>();
    const newerRead = deferred<Map<string, unknown>>();
    vi.mocked(collectNoteSnapshots)
      .mockReturnValueOnce(snapshots([]))
      .mockReturnValueOnce(snapshots(['Mix.md']));
    vi.mocked(collectBaseConfigs)
      .mockReturnValueOnce(olderRead.promise)
      .mockReturnValueOnce(newerRead.promise);
    const published: string[][] = [];
    const unsubscribe = plugin.onStateChange(() => {
      published.push(plugin.getState().queue.map((track) => track.path));
    });

    const olderRefresh = plugin.refresh();
    const newerRefresh = plugin.refresh();
    newerRead.resolve(new Map());
    await newerRefresh;
    expect(plugin.getState().queue.map((track) => track.path)).toEqual(['Song.md']);
    settle(olderRead);
    await olderRefresh;
    unsubscribe();

    expect(plugin.getState().queue.map((track) => track.path)).toEqual(['Song.md']);
    expect(plugin.getState().errorMessage).toBeNull();
    expect(published).toEqual([['Song.md']]);
  });
});
