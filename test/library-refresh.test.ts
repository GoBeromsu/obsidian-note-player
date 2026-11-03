import { describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian';
import NotePlayerPlugin from '../src/main';
import { DEFAULT_SETTINGS } from '../src/domain/config';
import { collectBaseConfigs, collectNoteSnapshots } from '../src/services/vault-io';
import type { MarkdownNoteSnapshot } from '../src/types/notes';

vi.mock('obsidian', () => ({
  App: class {},
  Plugin: class {
    constructor(readonly app: App) {}
  },
  debounce: (callback: () => void) => callback,
}));
vi.mock('../src/services/vault-io', () => ({
  collectNoteSnapshots: vi.fn(),
  collectBaseConfigs: vi.fn(),
}));
vi.mock('../src/ui/settings', () => ({ NotePlayerSettingsTab: class {} }));
vi.mock('../src/ui/commands', () => ({ registerCommands: vi.fn() }));
vi.mock('../src/ui/player-setup', () => ({ createPlayer: vi.fn() }));
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
