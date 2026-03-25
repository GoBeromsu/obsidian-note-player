import { normalizePath, Plugin, TFile, WorkspaceLeaf } from 'obsidian';
import { AudioCacheService } from './domain/audio-cache';
import { buildCompanionBaseFiles, MUSIC_BASE_NAME, PLAYLISTS_BASE_NAME } from './domain/base-files';
import { DEFAULT_SETTINGS, normalizeSettings } from './domain/config';
import { buildMusicLibrary } from './domain/library-index';
import { PlaybackStateManager } from './domain/playback-state';
import { NOTICE_CATALOG } from './domain/notices';
import { resolveSelectedPlaylistPath, getPlaylistOrThrow, toPlaylistSummary, toPlaylistTrack } from './domain/playlist-manager';
import { createPlaylistNoteContent, updatePlaylistNoteContent } from './domain/playlist-storage';
import { PluginLogger } from './shared/plugin-logger';
import { PluginNotices, type PluginNoticesHost } from './shared/plugin-notices';
import type { MusicLibrarySnapshot, PlaylistNote } from './types/music';
import type { MarkdownNoteSnapshot } from './types/notes';
import type { NotePlayerSettings } from './types/settings';
import type { AudioCachePort, PlaylistTrack, PlaylistViewHost, PlaylistViewState } from './types/view';
import { dedupe, sanitizeFileName } from './utils/dedupe';
import { canonicalizeNotePath } from './utils/wikilink';
import type { PlaybackState } from './types/playback';
import { NotePlayerSettingsTab } from './ui/settings';
import { VIEW_TYPE_NOTE_PLAYER, VIEW_TYPE_LEGACY, NotePlayerView } from './ui/views/NotePlayerView';
import { PlayerSurface } from './ui/views/PlayerSurface';
import { DownloadStatusBar } from './ui/download-status-bar';

const EMPTY_LIBRARY: MusicLibrarySnapshot = {
  tracks: [],
  playlists: [],
};

export default class NotePlayerPlugin extends Plugin implements PlaylistViewHost {
  settings: NotePlayerSettings = DEFAULT_SETTINGS;

  readonly logger = new PluginLogger('Note Player', () => this.settings.debug);
  readonly notices = new PluginNotices(
    this as unknown as PluginNoticesHost,
    NOTICE_CATALOG,
    'Note Player',
  );

  private library: MusicLibrarySnapshot = EMPTY_LIBRARY;
  private changeListeners = new Set<() => void>();
  private refreshTimeout: number | null = null;
  private readonly playback = new PlaybackStateManager();
  private isLoading = false;
  private errorMessage: string | null = null;
  private audioCacheService: AudioCacheService | null = null;
  private vaultBasePath = '';
  private playerSurface: PlayerSurface | null = null;
  private playerHostEl: HTMLDivElement | null = null;
  private viewPlaybackState: PlaybackState = 'idle';
  private downloadStatusBar: DownloadStatusBar | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    await this.refreshIndex();

    this.vaultBasePath = (this.app.vault.adapter as { getBasePath?(): string }).getBasePath?.() ?? '';
    if (this.vaultBasePath && AudioCacheService.isAvailable()) {
      this.audioCacheService = new AudioCacheService(this.vaultBasePath, this.app.vault.adapter, this.settings.audioFormat, undefined, this.app.vault.configDir);
    }

    this.playerHostEl = document.createElement('div');
    this.playerHostEl.className = 'onp-player-video';

    this.playerSurface = new PlayerSurface(
      this.playerHostEl,
      async () => { await this.playNext(); },
      (state: PlaybackState) => {
        if (this.viewPlaybackState === state) return;
        this.viewPlaybackState = state;
        this.notifyChange();
      },
    );

    if (this.audioCacheService) {
      this.playerSurface.setAudioCacheService(this.audioCacheService);
    }
    this.playerSurface.setRepeatMode(this.settings.repeatMode);

    this.downloadStatusBar = new DownloadStatusBar(this, () => this.playerSurface?.cancelDownload());
    this.playerSurface.onDownloadProgress = (percent: number, error?: string) => {
      const title = this.getState().currentTrack?.title ?? 'track';
      if (percent === 0) {
        this.notices.show('download_started', { title });
      } else if (percent === 100) {
        this.notices.show('download_complete', { title });
      } else if (percent === -1) {
        this.notices.show('download_failed', { reason: error ?? 'Unknown error' });
      }
      this.downloadStatusBar?.update(percent);
    };

    const createView = (leaf: WorkspaceLeaf) => new NotePlayerView(leaf, this, this.playerSurface!, this.playerHostEl!);
    this.registerView(VIEW_TYPE_NOTE_PLAYER, createView);
    this.registerView(VIEW_TYPE_LEGACY, createView);

    this.addRibbonIcon('play-square', 'Open note player', () => {
      void this.activateView();
    });

    this.addCommand({
      id: 'open-youtube-note-playlist',
      name: 'Open player view',
      callback: () => {
        void this.activateView();
      },
    });

    this.addCommand({
      id: 'refresh-youtube-note-library',
      name: 'Refresh music library',
      callback: () => {
        void this.refresh(true);
      },
    });

    this.addCommand({
      id: 'refresh-youtube-playlist-bases',
      name: 'Create or refresh companion Bases files',
      callback: () => {
        void this.refreshCompanionBases();
      },
    });

    this.addCommand({
      id: 'add-active-note-to-selected-playlist',
      name: 'Add active note to selected playlist',
      callback: () => {
        void this.addActiveNoteToSelectedPlaylist();
      },
    });

    this.addCommand({
      id: 'load-active-playlist-note',
      name: 'Load active playlist note into player',
      callback: () => {
        void this.activateActivePlaylist();
      },
    });

    this.addSettingTab(new NotePlayerSettingsTab(this.app, this));
    this.registerVaultRefreshEvents();

    if (this.settings.autoOpenOnStartup) {
      this.app.workspace.onLayoutReady(() => {
        void this.activateView();
      });
    }
  }

  onunload(): void {
    this.notices.unload();
    this.downloadStatusBar?.destroy();
    this.downloadStatusBar = null;
    this.playerSurface?.destroy();
    this.playerSurface = null;
    this.playerHostEl = null;

    if (this.refreshTimeout !== null) {
      window.clearTimeout(this.refreshTimeout);
      this.refreshTimeout = null;
    }
  }

  async loadSettings(): Promise<void> {
    const loaded = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()) as NotePlayerSettings;
    this.settings = normalizeSettings(loaded);
  }

  async saveSettings(): Promise<void> {
    this.settings = normalizeSettings(this.settings);
    await this.saveData(this.settings);

    if (this.vaultBasePath && AudioCacheService.isAvailable()) {
      this.audioCacheService = new AudioCacheService(this.vaultBasePath, this.app.vault.adapter, this.settings.audioFormat, undefined, this.app.vault.configDir);
      if (this.playerSurface) {
        this.playerSurface.setAudioCacheService(this.audioCacheService);
        this.playerSurface.setRepeatMode(this.settings.repeatMode);
      }
    }
  }

  getState(): PlaylistViewState {
    const selectedPlaylistPath = resolveSelectedPlaylistPath(this.settings.lastPlaylistPath, this.library.playlists);
    const selectedPlaylist =
      this.library.playlists.find((playlist) => playlist.path === selectedPlaylistPath) ?? null;
    const queue = selectedPlaylist?.tracks.map(toPlaylistTrack) ?? [];
    const currentTrack = this.playback.resolveCurrentTrack(queue, this.library.tracks, toPlaylistTrack);

    return {
      isLoading: this.isLoading,
      errorMessage: this.errorMessage,
      playlists: this.library.playlists.map(toPlaylistSummary),
      selectedPlaylistPath,
      queue,
      library: this.library.tracks.map(toPlaylistTrack),
      currentTrack,
      autoplayEnabled: this.settings.autoplayEnabled,
      playbackState: this.viewPlaybackState,
      repeatMode: this.settings.repeatMode,
    };
  }

  subscribe(callback: () => void): () => void {
    this.changeListeners.add(callback);
    return () => {
      this.changeListeners.delete(callback);
    };
  }

  async refresh(showNotice = false): Promise<void> {
    await this.refreshIndex();

    if (showNotice) {
      this.notices.show('library_refreshed', {
        trackCount: this.library.tracks.length,
        playlistCount: this.library.playlists.length,
      });
    }
  }

  async refreshCompanionBases(): Promise<void> {
    await this.writeCompanionBaseFiles(true);
  }

  async selectPlaylist(path: string | null): Promise<void> {
    this.settings.lastPlaylistPath = path;
    await this.saveSettings();
    this.playback.currentTrackPath = null;
    this.notifyChange();
  }

  async selectActivePlaylist(): Promise<void> {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      this.notices.show('active_note_not_playlist');
      return;
    }

    const playlist = this.library.playlists.find((entry) => entry.path === activeFile.path);
    if (!playlist) {
      this.notices.show('active_note_not_playlist');
      return;
    }

    await this.selectPlaylist(playlist.path);
    this.notices.show('playlist_loaded', { name: playlist.title });
  }

  async createPlaylist(name: string): Promise<void> {
    await this.createPlaylistNote(name);
  }

  playTrack(path: string): Promise<void> {
    this.playback.play(path, this.library.tracks);
    this.notifyChange();
    return Promise.resolve();
  }

  playPrevious(): Promise<void> {
    if (this.playback.previous(this.currentQueue())) {
      this.notifyChange();
    }
    return Promise.resolve();
  }

  playNext(): Promise<void> {
    if (this.playback.next(this.currentQueue(), this.settings.repeatMode)) {
      this.notifyChange();
    }
    return Promise.resolve();
  }

  async addTrackToPlaylist(trackPath: string): Promise<void> {
    const playlistPath = resolveSelectedPlaylistPath(this.settings.lastPlaylistPath, this.library.playlists);
    if (!playlistPath) {
      this.notices.show('playlist_missing');
      return;
    }

    await this.addTrackToSpecificPlaylist(playlistPath, trackPath);
    if (!this.playback.currentTrackPath) {
      this.playback.currentTrackPath = trackPath;
      this.notifyChange();
    }
  }

  async addActiveNoteToPlaylist(): Promise<void> {
    await this.addActiveNoteToSelectedPlaylist();
  }

  async removeTrackFromPlaylist(trackPath: string): Promise<void> {
    const playlistPath = resolveSelectedPlaylistPath(this.settings.lastPlaylistPath, this.library.playlists);
    if (!playlistPath) {
      this.notices.show('playlist_missing');
      return;
    }

    await this.removeTrackFromSpecificPlaylist(playlistPath, trackPath);
    if (this.playback.currentTrackPath === trackPath) {
      this.playback.currentTrackPath = this.currentQueue()[0]?.path ?? null;
      this.notifyChange();
    }
  }

  async moveTrackInPlaylist(fromIndex: number, toIndex: number): Promise<void> {
    const playlist = this.selectedPlaylist();
    if (!playlist || fromIndex === toIndex) return;
    if (fromIndex < 0 || toIndex < 0 || fromIndex >= playlist.trackPaths.length || toIndex >= playlist.trackPaths.length) {
      return;
    }

    const nextTrackPaths = [...playlist.trackPaths];
    const [movedPath] = nextTrackPaths.splice(fromIndex, 1);
    nextTrackPaths.splice(toIndex, 0, movedPath);

    const nextTracks = [...playlist.tracks];
    const [movedTrack] = nextTracks.splice(fromIndex, 1);
    nextTracks.splice(toIndex, 0, movedTrack);

    playlist.trackPaths = nextTrackPaths;
    playlist.tracks = nextTracks;
    this.notifyChange();

    await this.savePlaylistTracks(playlist.path, nextTrackPaths);
  }

  async openNote(path: string): Promise<void> {
    await this.revealTrack(path);
  }

  async openPlaylist(path: string): Promise<void> {
    await this.revealPlaylist(path);
  }

  async openBase(kind: 'music' | 'playlists'): Promise<void> {
    await this.openCompanionBase(kind === 'music' ? MUSIC_BASE_NAME : PLAYLISTS_BASE_NAME);
  }

  async toggleAutoplay(): Promise<void> {
    await this.setAutoplayEnabled(!this.settings.autoplayEnabled);
  }

  async toggleRepeatMode(): Promise<void> {
    this.settings.repeatMode = this.settings.repeatMode === 'one' ? 'none' : 'one';
    this.playerSurface?.setRepeatMode(this.settings.repeatMode);
    await this.saveSettings();
    this.notifyChange();
  }

  getAudioCacheService(): AudioCachePort | null {
    return this.audioCacheService;
  }

  async setAutoplayEnabled(enabled: boolean): Promise<void> {
    this.settings.autoplayEnabled = enabled;
    await this.saveSettings();
    this.notifyChange();
  }

  private async addTrackToSpecificPlaylist(playlistPath: string, trackPath: string): Promise<void> {
    const playlist = getPlaylistOrThrow(playlistPath, this.library.playlists);
    const nextTrackPaths = dedupe([...playlist.trackPaths, trackPath]);
    await this.savePlaylistTracks(playlistPath, nextTrackPaths, { refresh: true });

    const track = this.library.tracks.find((entry) => entry.path === trackPath);
    this.notices.show('track_added', {
      title: track?.title ?? trackPath,
      playlist: playlist.title,
    });
  }

  private async removeTrackFromSpecificPlaylist(playlistPath: string, trackPath: string): Promise<void> {
    const playlist = getPlaylistOrThrow(playlistPath, this.library.playlists);
    const nextTrackPaths = playlist.trackPaths.filter((entry) => entry !== trackPath);
    await this.savePlaylistTracks(playlistPath, nextTrackPaths, { refresh: true });

    const track = this.library.tracks.find((entry) => entry.path === trackPath);
    this.notices.show('track_removed', {
      title: track?.title ?? trackPath,
      playlist: playlist.title,
    });
  }

  private async createPlaylistNote(name: string, seedTrackPaths: string[] = []): Promise<void> {
    const filePath = await this.getAvailablePlaylistPath(name);
    await this.ensureFolder(this.settings.playlistFolder);
    await this.app.vault.create(
      filePath,
      createPlaylistNoteContent({ trackPaths: seedTrackPaths }, this.settings),
    );

    this.settings.lastPlaylistPath = filePath;
    await this.saveSettings();
    await this.refreshIndex();

    this.notices.show('playlist_created', { name });
  }

  async revealTrack(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      await this.app.workspace.getLeaf('tab').openFile(file);
    }
  }

  async revealPlaylist(path: string): Promise<void> {
    await this.revealTrack(path);
  }

  private async activateView(): Promise<void> {
    const existing = [
      ...this.app.workspace.getLeavesOfType(VIEW_TYPE_NOTE_PLAYER),
      ...this.app.workspace.getLeavesOfType(VIEW_TYPE_LEGACY),
    ];
    if (existing.length > 0) {
      void this.app.workspace.revealLeaf(existing[0]);
      return;
    }

    const leaf = this.app.workspace.getLeaf('tab');
    await leaf.setViewState({ type: VIEW_TYPE_NOTE_PLAYER, active: true });
    void this.app.workspace.revealLeaf(leaf);
  }

  private registerVaultRefreshEvents(): void {
    this.registerEvent(
      this.app.metadataCache.on('changed', () => {
        this.scheduleRefresh();
      }),
    );

    this.registerEvent(
      this.app.metadataCache.on('resolved', () => {
        this.scheduleRefresh();
      }),
    );

    this.registerEvent(
      this.app.vault.on('rename', () => {
        this.scheduleRefresh();
      }),
    );

    this.registerEvent(
      this.app.vault.on('delete', () => {
        this.scheduleRefresh();
      }),
    );

    this.registerEvent(
      this.app.vault.on('create', () => {
        this.scheduleRefresh();
      }),
    );
  }

  private scheduleRefresh(): void {
    if (this.refreshTimeout !== null) {
      window.clearTimeout(this.refreshTimeout);
    }

    this.refreshTimeout = window.setTimeout(() => {
      this.refreshTimeout = null;
      void this.refreshIndex();
    }, 250);
  }

  private async refreshIndex(): Promise<void> {
    this.isLoading = true;
    this.errorMessage = null;
    this.notifyChange();

    try {
      this.library = buildMusicLibrary(this.collectNoteSnapshots(), this.settings);

      const selected = resolveSelectedPlaylistPath(this.settings.lastPlaylistPath, this.library.playlists);
      if (this.library.playlists.length > 0 && selected !== this.settings.lastPlaylistPath) {
        if (!this.settings.lastPlaylistPath ||
            !this.library.playlists.some((p) => p.path === this.settings.lastPlaylistPath)) {
          this.settings.lastPlaylistPath = selected;
          await this.saveSettings();
        }
      }

      this.playback.validateCurrent(this.library.tracks);

    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Failed to refresh library', error);
    } finally {
      this.isLoading = false;
      this.notifyChange();
    }
  }

  private collectNoteSnapshots(): MarkdownNoteSnapshot[] {
    return this.app.vault.getMarkdownFiles().map((file) => ({
      path: file.path,
      basename: file.basename,
      frontmatter: this.app.metadataCache.getFileCache(file)?.frontmatter,
    }));
  }

  private async savePlaylistTracks(
    playlistPath: string,
    trackPaths: string[],
    opts: { refresh?: boolean } = {},
  ): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(playlistPath);
    if (!(file instanceof TFile)) {
      throw new Error(`Playlist file not found: ${playlistPath}`);
    }

    const existing = await this.app.vault.read(file);
    const playlist = getPlaylistOrThrow(playlistPath, this.library.playlists);
    const nextContent = updatePlaylistNoteContent(existing, {
      trackPaths: trackPaths.map((trackPath) => canonicalizeNotePath(trackPath)),
      coverUrl: playlist.coverUrl || undefined,
      description: playlist.description || undefined,
    }, this.settings);

    await this.app.vault.modify(file, nextContent);

    if (opts.refresh) {
      await this.refreshIndex();
      this.notices.show('playlist_saved', { name: playlist.title });
    }
  }

  private async activateActivePlaylist(): Promise<void> {
    await this.selectActivePlaylist();
    await this.activateView();
  }

  private async writeCompanionBaseFiles(showNotice: boolean): Promise<void> {
    const baseFiles = buildCompanionBaseFiles(this.settings.playlistFolder, this.settings);

    for (const baseFile of baseFiles) {
      const filePath = normalizePath(baseFile.path);
      const existing = this.app.vault.getAbstractFileByPath(filePath);

      if (existing instanceof TFile) {
        await this.app.vault.modify(existing, baseFile.content);
        continue;
      }

      if (existing) {
        throw new Error(`Unable to write base file at ${filePath}`);
      }

      const parentFolder = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : '';
      await this.ensureFolder(parentFolder);
      await this.app.vault.create(filePath, baseFile.content);
    }

    if (showNotice) {
      const firstFile = baseFiles[0]?.path ?? '';
      const folder = firstFile.includes('/') ? firstFile.slice(0, firstFile.lastIndexOf('/')) : '/';
      this.notices.show('bases_refreshed', {
        count: baseFiles.length,
        folder: folder || '/',
      });
    }
  }

  private async addActiveNoteToSelectedPlaylist(): Promise<void> {
    const playlistPath = resolveSelectedPlaylistPath(this.settings.lastPlaylistPath, this.library.playlists);
    if (!playlistPath) {
      this.notices.show('playlist_missing');
      return;
    }

    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      this.notices.show('active_note_not_music');
      return;
    }

    const track = this.library.tracks.find((entry) => entry.path === activeFile.path);
    if (!track) {
      this.notices.show('active_note_not_music');
      return;
    }

    await this.addTrackToSpecificPlaylist(playlistPath, track.path);
  }

  private async openCompanionBase(fileName: string): Promise<void> {
    const filePath = normalizePath(this.getCompanionBasePath(fileName));
    let file = this.app.vault.getAbstractFileByPath(filePath);

    if (!(file instanceof TFile)) {
      await this.writeCompanionBaseFiles(false);
      file = this.app.vault.getAbstractFileByPath(filePath);
    }

    if (!(file instanceof TFile)) {
      throw new Error(`Base file not found: ${filePath}`);
    }

    await this.app.workspace.getLeaf('tab').openFile(file);
  }

  private selectedPlaylist(): PlaylistNote | null {
    const selectedPlaylistPath = resolveSelectedPlaylistPath(this.settings.lastPlaylistPath, this.library.playlists);
    return this.library.playlists.find((playlist) => playlist.path === selectedPlaylistPath) ?? null;
  }

  private currentQueue(): PlaylistTrack[] {
    return this.selectedPlaylist()?.tracks.map(toPlaylistTrack) ?? [];
  }

  private getCompanionBasePath(fileName: string): string {
    const match = buildCompanionBaseFiles(this.settings.playlistFolder, this.settings).find((file) =>
      file.path === fileName || file.path.endsWith(`/${fileName}`),
    );

    return match?.path ?? fileName;
  }

  private getAvailablePlaylistPath(name: string): string {
    const baseName = sanitizeFileName(name);
    let attempt = normalizePath(`${this.settings.playlistFolder}/${baseName}.md`);
    let index = 2;

    while (this.app.vault.getAbstractFileByPath(attempt)) {
      attempt = normalizePath(`${this.settings.playlistFolder}/${baseName} ${index}.md`);
      index += 1;
    }

    return attempt;
  }

  private async ensureFolder(folderPath: string): Promise<void> {
    if (!folderPath) {
      return;
    }

    const segments = folderPath.split('/').filter(Boolean);
    let current = '';

    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      if (!this.app.vault.getAbstractFileByPath(current)) {
        await this.app.vault.createFolder(current);
      }
    }
  }

  private notifyChange(): void {
    for (const listener of this.changeListeners) {
      listener();
    }
  }
}

