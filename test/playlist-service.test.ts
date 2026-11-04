import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App, Component, Notice } from 'obsidian';
import { DEFAULT_SETTINGS } from '../src/domain/config';
import { PlaylistService } from '../src/services/playlist-service';
import type { VaultWriteHost } from '../src/services/vault-io';
import type { MusicLibrarySnapshot } from '../src/types/music';

const disk = vi.hoisted(() => ({
  notes: new Map<string, Record<string, unknown>>(),
  files: new Map<string, string>(),
  writes: new Map<string, { entered(): void; wait: Promise<void> }>(),
}));

vi.mock('obsidian', async () => ({
  Component: (await import('./helpers/migration-obsidian')).Component,
  App: class {
    vault = {
      getAbstractFileByPath: (path: string) => disk.files.has(path) ? { path } : null,
      create: (path: string, content: string) => {
        disk.files.set(path, content);
        return Promise.resolve({ path, basename: path.split('/').pop()?.replace(/\.md$/, '') });
      },
    };
    metadataCache = {
      getFirstLinkpathDest: (path: string) => disk.files.has(path) ? { path } : null,
    };
  },
  TFile: class {},
  Notice: vi.fn(),
}));

// The real Obsidian frontmatter writer is exercised in the dev vault; this boundary stores the edits.
vi.mock('../src/services/vault-io', () => ({
  ensureFolder: () => Promise.resolve(),
  waitForMetadata: () => Promise.resolve(),
  updateFrontmatter: async (_host: VaultWriteHost, path: string, edit: (fm: Record<string, unknown>) => void) => {
    const fm = disk.notes.get(path);
    if (!fm) throw new Error(`Missing fixture: ${path}`);
    const blocked = disk.writes.get(path);
    disk.writes.delete(path);
    blocked?.entered();
    if (blocked) await blocked.wait;
    edit(fm);
  },
}));

function setup() {
  const library: MusicLibrarySnapshot = {
    tracks: [], playlists: [{
      path: 'Lists/Mix.md', basePath: 'Lists/Mix.base', title: 'Mix',
      coverUrl: '', description: '', tracks: [], trackPaths: [],
    }],
  };
  const selected: string[] = [];
  const service = new PlaylistService({
    app: new App(), owner: new Component(), getSettings: () => ({ ...DEFAULT_SETTINGS, playlistFolder: 'Lists' }),
    getLibrary: () => library, refresh: () => Promise.resolve(),
    selectPlaylist: (path) => { selected.push(path); return Promise.resolve(); },
    saveSettings: () => Promise.resolve(), invalidateRefresh: () => {},
  });
  disk.files.set('Lists/Mix.md', '');
  disk.files.set('Lists/Other.md', '');
  disk.notes.set('Song.md', { source: 'youtube-url' });
  return { service, selected };
}

beforeEach(() => { disk.notes.clear(); disk.files.clear(); disk.writes.clear(); });

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => { resolve = () => done(); });
  return { promise, resolve };
}

describe('playlist membership writes', () => {
  it('uses the basename when adding a track outside the library', async () => {
    const { service } = setup();
    disk.notes.set('Elsewhere/Outside Track.md', {});

    await service.addTracks('Lists/Mix.md', ['Elsewhere/Outside Track.md']);

    expect(Notice).toHaveBeenLastCalledWith('Added Outside Track to Mix.', 3500);
  });

  it('creates a unique base and companion without writing a legacy track list', async () => {
    const { service, selected } = setup();
    disk.files.set('Lists/Mix.base', 'unrelated base');

    const path = await service.createPlaylist('Mix');

    expect(path).toBe('Lists/Mix 2.md');
    expect(selected).toEqual([path]);
    expect(disk.files.get(path)).toContain('![[Mix 2.base]]');
    expect(disk.files.get('Lists/Mix 2.base')).toContain('list(playlists).contains(this)');
    expect(disk.files.get('Lists/Mix.base')).toBe('unrelated base');
  });

  it('deduplicates resolved aliases while preserving unrelated and missing memberships', async () => {
    const { service } = setup();
    disk.notes.set('Song.md', { playlists: ['[[Lists/Mix|alias]]', '[[Lists/Mix]]', '[[Lists/Other]]', '[[missing]]'] });

    await service.addTracks('Lists/Mix.md', ['Song.md']);

    expect(disk.notes.get('Song.md')?.playlists).toEqual(['[[Lists/Mix|alias]]', '[[Lists/Other]]', '[[missing]]']);
  });

  it.each([undefined, '[[missing]]', '[[Lists/Other]]', 'Lists/Mix'])('normalizes scalar membership %j without losing it', async (membership) => {
    const { service } = setup();
    disk.notes.set('Song.md', { playlists: membership });

    await service.addTracks('Lists/Mix.md', ['Song.md']);

    expect(disk.notes.get('Song.md')?.playlists).toEqual([
      ...(membership === undefined ? [] : [membership]), '[[Lists/Mix]]',
    ]);
  });

  it('serializes quick add and remove against the latest file value', async () => {
    const { service } = setup();
    disk.notes.set('Song.md', { playlists: ['[[Lists/Other]]'] });
    const entered = deferred();
    const release = deferred();
    disk.writes.set('Song.md', { entered: () => entered.resolve(), wait: release.promise });

    const added = service.addTracks('Lists/Mix.md', ['Song.md']);
    await entered.promise;
    const removed = service.removeTrack('Lists/Mix.md', 'Song.md');
    release.resolve();
    await Promise.all([added, removed]);

    expect(disk.notes.get('Song.md')).toEqual({ playlists: ['[[Lists/Other]]'] });
  });
});
