import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, TFile, TFolder, type CachedMetadata, type TAbstractFile } from 'obsidian';
import { DEFAULT_PROPERTY_MAPPING, DEFAULT_SETTINGS } from '../src/domain/config';
import { buildMusicLibrary } from '../src/domain/library-index';
import { collectBaseConfigs, collectNoteSnapshots } from '../src/services/vault-io';

const storage = vi.hoisted(() => ({
  files: new Map<string, TAbstractFile>(),
  caches: new Map<string, CachedMetadata>(),
  contents: new Map<string, string>(),
  links: new Map<string, Record<string, number>>(),
}));

vi.mock('obsidian', () => {
  class TFile {}
  class TFolder {
    children: TAbstractFile[] = [];
    path = '';
    isRoot() { return this.path === '/'; }
  }
  return {
    TFile, TFolder,
    normalizePath: (path: string) => path.replace(/^\/|\/$/g, ''),
    parseLinktext: (text: string) => ({ path: text.split('#')[0] ?? '', subpath: text.includes('#') ? text.slice(text.indexOf('#')) : '' }),
    parseYaml: (content: string) => JSON.parse(content),
    App: class {
      vault = {
        getMarkdownFiles: () => [...storage.files.values()].filter((file) => file instanceof TFile && Reflect.get(file, 'extension') === 'md'),
        getRoot: () => storage.files.get('/'),
        getFolderByPath: (path: string) => storage.files.get(path) ?? null,
        getFileByPath: (path: string) => storage.files.get(path) ?? null,
        cachedRead: (file: TAbstractFile) => Promise.resolve(storage.contents.get(file.path)),
      };
      metadataCache = {
        getFileCache: (file: TAbstractFile) => storage.caches.get(file.path),
        getFirstLinkpathDest: (path: string) => storage.files.get(path) ?? null,
        get resolvedLinks() { return Object.fromEntries(storage.links); },
      };
    },
  };
});

function folder(path: string): TFolder {
  const result = new TFolder();
  result.path = path;
  storage.files.set(path, result);
  return result;
}

function note(path: string, cache: CachedMetadata = {}): TFile {
  const result = new TFile();
  result.path = path;
  result.basename = path.slice(path.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');
  result.extension = path.split('.').pop() ?? '';
  result.stat = { ctime: 10, mtime: 20, size: 0 };
  storage.files.set(path, result);
  storage.caches.set(path, cache);
  return result;
}

const position = { start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: 0, offset: 0 } };

beforeEach(() => { storage.files.clear(); storage.caches.clear(); storage.contents.clear(); storage.links.clear(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('vault library snapshots', () => {
  it('discovers notes from the metadata cache without folder traversal or note reads', () => {
    const app = new App();
    const root = vi.spyOn(app.vault, 'getRoot').mockImplementation(() => { throw new Error('No folder walk'); });
    const folder = vi.spyOn(app.vault, 'getFolderByPath').mockImplementation(() => { throw new Error('No folder walk'); });
    const read = vi.spyOn(app.vault, 'cachedRead');
    note('Music/Nested/Song.md', { frontmatter: { type: 'music', source: 'https://youtu.be/dQw4w9WgXcQ' } });
    note('Musician/Excluded.md');

    const snapshots = collectNoteSnapshots(app, ['Music'], DEFAULT_PROPERTY_MAPPING);

    expect(snapshots.map((entry) => entry.path)).toEqual(['Music/Nested/Song.md']);
    expect(root).not.toHaveBeenCalled();
    expect(folder).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it.each(['playlistFolder', 'musicFolder'] as const)('discovers nested playlists and music when %s is vault root', (key) => {
    const root = folder('/');
    const nested = folder('Nested');
    const music = folder('Music');
    const playlists = folder('Playlists');
    const base = note('Nested/Hidden.base');
    const companion = note('Nested/Hidden.md', {
      frontmatter: { type: 'music-playlist' },
      embeds: [{ link: base.path, original: '![[Nested/Hidden.base]]', position }],
    });
    const track = note('Nested/Song.md', {
      frontmatter: { type: 'music', source: 'https://youtu.be/dQw4w9WgXcQ' },
    });
    nested.children = [companion, base, track];
    root.children = [nested, music, playlists];
    const settings = { ...DEFAULT_SETTINGS, musicFolder: 'Music', playlistFolder: 'Playlists', [key]: '/' };

    const snapshots = collectNoteSnapshots(new App(), [settings.musicFolder, settings.playlistFolder], settings);
    const library = buildMusicLibrary(snapshots, settings, new Map());

    expect(library.playlists.map((playlist) => playlist.path)).toEqual(['Nested/Hidden.md']);
    expect(library.tracks.map((entry) => entry.path)).toEqual(['Nested/Song.md']);
  });

  it.each(['', '#ViewName', '#^row', '#ViewName|Alias'])('includes backlink members outside a non-root folder through base subpath %s', (subpath) => {
    const root = folder('/');
    const playlists = folder('Playlists');
    const nested = folder('Elsewhere');
    const base = note('Playlists/Mix.base');
    const companion = note('Playlists/Mix.md', {
      frontmatter: { type: 'music-playlist' },
      embeds: [{ link: base.path + subpath, original: `![[Mix.base${subpath}]]`, position }],
    });
    const outside = note('Elsewhere/Song.md', {
      frontmatter: { type: 'music', source: 'https://youtu.be/dQw4w9WgXcQ' },
      frontmatterLinks: [{ key: 'playlists.0', link: companion.path, original: '[[Mix]]' }],
    });
    const unlinked = note('Elsewhere/Unlinked.md');
    nested.children = [outside, unlinked];
    playlists.children = [companion, base];
    root.children = [playlists, nested];
    storage.links.set(outside.path, { [companion.path]: 1 });

    const snapshots = collectNoteSnapshots(new App(), ['Playlists'], DEFAULT_PROPERTY_MAPPING);
    const library = buildMusicLibrary(snapshots, DEFAULT_PROPERTY_MAPPING, new Map());

    expect(snapshots.map((item) => item.path)).toEqual(['Playlists/Mix.md', 'Elsewhere/Song.md']);
    expect(snapshots[1]).toMatchObject({
      ctime: 10, mtime: 20, frontmatterLinks: { playlists: ['Playlists/Mix.md'] }, embeddedBases: [],
    });
    expect(library.playlists[0]?.trackPaths).toEqual([outside.path]);
  });

  it.each(['', '#ViewName', '#^row', '#ViewName|Alias'])('reads only playlist-embedded bases with subpath %s and applies their player sort', async (subpath) => {
    const root = folder('/');
    const base = note('Custom.base');
    const playlist = note('Mix.md', {
      frontmatter: { type: 'music-playlist' },
      embeds: [{ link: base.path + subpath, original: `![[Custom.base${subpath}]]`, position }],
    });
    const tracks = ['A', 'Z'].map((name) => note(`${name}.md`, {
      frontmatter: { type: 'music', source: 'https://youtu.be/dQw4w9WgXcQ' },
      frontmatterLinks: [{ key: 'playlists.0', link: playlist.path, original: '[[Mix]]' }],
    }));
    root.children = [playlist, ...tracks, note('Other.md', {
      embeds: [{ link: 'Unrelated.base', original: '![[Unrelated.base]]', position }],
    })];
    storage.contents.set(base.path, JSON.stringify({ views: [{
      type: 'note-player', sort: [{ property: 'file.name', direction: 'DESC' }],
    }] }));
    const app = new App();
    const snapshots = collectNoteSnapshots(app, ['/'], DEFAULT_PROPERTY_MAPPING);

    const configs = await collectBaseConfigs(app, snapshots, 'music-playlist');
    const library = buildMusicLibrary(snapshots, DEFAULT_PROPERTY_MAPPING, configs);

    expect([...configs.keys()]).toEqual([base.path]);
    expect(library.playlists[0]?.basePath).toBe('Custom.base');
    expect(library.playlists[0]?.trackPaths).toEqual(['Z.md', 'A.md']);
  });
});
