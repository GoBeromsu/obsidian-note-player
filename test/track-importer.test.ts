import { describe, expect, it, vi } from 'vitest';
import { App, TFile } from 'obsidian';
import { DEFAULT_SETTINGS } from '../src/domain/config';
import { TrackImporter } from '../src/services/track-importer';
import type { AudioCachePort } from '../src/types/view';
import type { MusicLibrarySnapshot } from '../src/types/music';

vi.mock('obsidian', () => ({
  App: class {
    vault = {
      getFileByPath: () => null,
      cachedRead: () => Promise.resolve(''),
    };
    workspace = { getLeavesOfType: () => [] };
    metadataCache = { resolvedLinks: {}, getCache: () => null };
    fileManager = { processFrontMatter: () => Promise.resolve() };
  },
  TFile: class {},
  TFolder: class {},
  MarkdownView: class {},
  Notice: class {},
  normalizePath: (path: string) => path,
}));

describe('TrackImporter metadata destinations', () => {
  it.each([
    { property: '', withTitle: false }, { property: '   ', withTitle: false },
    { property: '', withTitle: true }, { property: '   ', withTitle: true },
    { property: 'performer', withTitle: true },
  ])('heals without writing empty artist keys: %j', async ({ property, withTitle }) => {
    const videoId = 'DEyzYWLvXqA';
    const app = new App();
    const file = new TFile();
    file.path = 'Track.md';
    file.basename = withTitle ? videoId : 'Healed title';
    const frontmatter: Record<string, unknown> = { source: videoId };
    vi.spyOn(app.vault, 'getFileByPath').mockReturnValue(file);
    const write = vi.spyOn(app.fileManager, 'processFrontMatter').mockImplementation(async (_file, edit) => {
      edit(frontmatter);
    });
    app.metadataCache.resolvedLinks = withTitle ? { 'Journal.md': { 'Track.md': 1 } } : {};
    const cache: AudioCachePort = {
      hasCached: () => Promise.resolve(false), getFileUrl: () => '', download: () => Promise.resolve(''),
      cancel: () => undefined, isAvailable: () => true, checkAvailable: () => Promise.resolve(true),
      metaFor: () => ({ title: 'Healed title', author: 'Band' }),
    };
    const library: MusicLibrarySnapshot = { tracks: [{
      path: file.path, title: videoId, artist: '', sourceUrl: '', watchUrl: '', videoId, thumbnailUrl: '', tags: [],
    }], playlists: [] };
    // The subsequent refresh no longer contains this note; no timer-based index settling is needed.
    const getLibrary = vi.fn<() => MusicLibrarySnapshot>()
      .mockReturnValueOnce(library).mockReturnValue({ tracks: [], playlists: [] });
    const importer = new TrackImporter({
      app, getSettings: () => ({ ...DEFAULT_SETTINGS, musicArtistProperty: property }), getLibrary,
      getSelectedPlaylistPath: () => null, getAudioCache: () => cache,
      createPlaylist: () => Promise.resolve(''), addTracks: () => Promise.resolve(),
      playIfIdle: () => undefined, onPendingChange: () => undefined, onTrackRename: () => undefined,
    });

    await importer.healTrack(videoId);

    expect(frontmatter).toEqual({
      source: videoId, ...(withTitle ? { title: 'Healed title' } : {}),
      ...(property.trim() ? { performer: 'Band' } : {}),
    });
    if (!withTitle && !property.trim()) expect(write).not.toHaveBeenCalled();
  });
});
