import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App, TFile, TFolder, type CachedMetadata, type TAbstractFile } from 'obsidian';
import { DEFAULT_PROPERTY_MAPPING } from '../src/domain/config';
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

describe('vault library snapshots', () => {
  it.each(['', '#ViewName', '#^row', '#ViewName|Alias'])('keeps root shallow and includes backlink members through base subpath %s', (subpath) => {
    const root = folder('/');
    const nested = folder('Elsewhere');
    const base = note('Mix.base');
    const companion = note('Mix.md', {
      frontmatter: { type: 'music-playlist' },
      embeds: [{ link: base.path + subpath, original: `![[Mix.base${subpath}]]`, position }],
    });
    const outside = note('Elsewhere/Song.md', {
      frontmatter: { type: 'music', source: 'https://youtu.be/dQw4w9WgXcQ' },
      frontmatterLinks: [{ key: 'playlists.0', link: companion.path, original: '[[Mix]]' }],
    });
    const unlinked = note('Elsewhere/Unlinked.md');
    nested.children = [outside, unlinked];
    root.children = [companion, base, nested];
    storage.links.set(outside.path, { [companion.path]: 1 });

    const snapshots = collectNoteSnapshots(new App(), ['/'], DEFAULT_PROPERTY_MAPPING);
    const library = buildMusicLibrary(snapshots, DEFAULT_PROPERTY_MAPPING, new Map());

    expect(snapshots.map((item) => item.path)).toEqual(['Mix.md', 'Elsewhere/Song.md']);
    expect(snapshots[1]).toMatchObject({
      ctime: 10, mtime: 20, frontmatterLinks: { playlists: ['Mix.md'] }, embeddedBases: [],
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
