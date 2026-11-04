import { debounce, normalizePath, Plugin, WorkspaceLeaf } from 'obsidian';
import { plural } from './utils/plural';
import { MUSIC_BASE_NAME, PLAYLISTS_BASE_NAME } from './domain/base-files';
import { DEFAULT_SETTINGS, normalizeSettings, VAULT_ROOT } from './domain/config';
import { buildMusicLibrary } from './domain/library-index';
import { isUnavailable, trackLabel } from './domain/track-import';
import { PlaybackStateManager } from './domain/playback-state';
import { resolveSelectedPlaylistPath, successorAfterRemoval, toPlaylistSummary, toPlaylistTrack } from './domain/playlist-manager';
import type { MusicLibrarySnapshot, PlaylistNote } from './types/music';
import type { NotePlayerSettings } from './types/settings';
import type { AudioCachePort, PlaylistTrack, PlaylistViewHost, PlaylistViewState } from './types/view';
import { AudioCacheService } from './services/audio-cache';
import { PeaksStore } from './services/peaks-store';
import { ThumbnailCacheService } from './services/thumbnail-cache';
import { openCompanionBase, writeCompanionBaseFiles } from './services/companion-bases';
import { TrackImporter } from './services/track-importer';
import { PlaylistService } from './services/playlist-service';
import { convertPlaylistNotes } from './services/playlist-migration-service';
import { openNoteInTab, collectNoteSnapshots, collectBaseConfigs } from './services/vault-io';
import { registerCommands } from './ui/commands';
import { showNotice } from './ui/notices';
import type { PlaybackState } from './types/playback';
import { NotePlayerSettingsTab } from './ui/settings';
import { VIEW_TYPE_NOTE_PLAYER, VIEW_TYPE_LEGACY, NotePlayerView } from './ui/views/NotePlayerView';
import { PLAYLIST_BASES_VIEW_TYPE, PlaylistBasesView } from './ui/views/PlaylistBasesView';
import type { PlayerSurface } from './ui/views/PlayerSurface';
import type { DownloadStatusBar } from './ui/download-status-bar';
import { createPlayer } from './ui/player-setup';
import type { VolumeController } from './ui/volume';

const EMPTY_LIBRARY: MusicLibrarySnapshot = {
  tracks: [],
  playlists: [],
};

export default class NotePlayerPlugin extends Plugin implements PlaylistViewHost {
  settings: NotePlayerSettings = DEFAULT_SETTINGS;

  private library: MusicLibrarySnapshot = EMPTY_LIBRARY;
  private refreshGeneration = 0;
  private changeListeners = new Set<() => void>();
  private readonly scheduleRefresh = debounce(() => { void this.refreshIndex(); }, 250, true);
  private readonly playback = new PlaybackStateManager();
  private errorMessage: string | null = null;
  private audioCacheService: AudioCacheService | null = null;
  private peaksStore: PeaksStore | null = null;
  private thumbnailCache: ThumbnailCacheService | null = null;
  private vaultBasePath = '';
  private playerSurface: PlayerSurface | null = null;
  private playerHostEl: HTMLDivElement | null = null;
  private viewPlaybackState: PlaybackState = 'idle';
  /** Set by an explicit play so the track starts even with autoplay off. */
  private playIntent = false;
  private playingPlaylistPath: string | null = null;
  private downloadStatusBar: DownloadStatusBar | null = null;
  private volume: VolumeController | null = null;
  private readonly playlists = new PlaylistService({
    app: this.app,
    owner: this,
    getSettings: () => this.settings,
    getLibrary: () => this.library,
    refresh: () => this.refreshIndex(),
    selectPlaylist: (path) => this.selectPlaylist(path),
  });
  private readonly importer = new TrackImporter({
    app: this.app,
    getSettings: () => this.settings,
    getLibrary: () => this.library,
    getSelectedPlaylistPath: () => this.selectedPlaylist()?.path ?? null,
    getAudioCache: () => this.audioCacheService,
    createPlaylist: (name) => this.playlists.createPlaylist(name),
    addTracks: (playlistPath, paths) => this.playlists.addTracks(playlistPath, paths, false),
    playIfIdle: (path) => {
      if (this.viewPlaybackState !== 'playing' && this.viewPlaybackState !== 'loading') void this.playTrack(path);
    },
    onPendingChange: () => this.notifyChange(),
    onTrackRename: (from, to) => this.playback.followRename(from, to),
  });

  async onload(): Promise<void> {
    await this.loadSettings();
    let migratedFolders = false;
    for (const key of ['musicFolder', 'playlistFolder'] as const) {
      if (this.settings[key] !== '') continue;
      const folder = normalizePath(this.app.fileManager.getNewFileParent('').path);
      this.settings[key] = folder === '' || folder === VAULT_ROOT ? VAULT_ROOT : folder;
      migratedFolders = true;
    }
    if (migratedFolders) await this.saveData(this.settings);
    this.thumbnailCache = ThumbnailCacheService.attach(this, () => this.notifyChange());
    await this.refreshIndex();

    this.vaultBasePath = (this.app.vault.adapter as { getBasePath?(): string }).getBasePath?.() ?? '';
    this.audioCacheService = this.createAudioCache();

    const player = createPlayer(this, {
      onEnded: () => this.playNext(false),
      openView: () => void this.activateView(),
      onStateChange: (state) => {
        if (this.viewPlaybackState === state) return;
        this.viewPlaybackState = state;
        this.notifyChange();
        if (state === 'playing') void this.prefetchNext();
      },
      volume: {
        level: this.settings.volume,
        muted: this.settings.volumeMuted,
        persist: (state) => {
          this.settings.volume = state.level;
          this.settings.volumeMuted = state.muted;
          void this.saveData(this.settings);
        },
      },
    });
    this.volume = player.volume;
    this.playerSurface = player.surface;
    this.playerHostEl = player.hostEl;
    this.downloadStatusBar = player.statusBar;
    if (this.audioCacheService) this.playerSurface.setAudioCacheService(this.audioCacheService);
    this.playerSurface.setRepeatMode(this.settings.repeatMode);

    const createView = (leaf: WorkspaceLeaf) => new NotePlayerView(leaf, this, this.playerSurface!, this.playerHostEl!, this.volume!);
    this.registerView(VIEW_TYPE_NOTE_PLAYER, createView);
    this.registerView(VIEW_TYPE_LEGACY, createView);
    const basesViewRegistered = this.registerBasesView(PLAYLIST_BASES_VIEW_TYPE, {
      name: 'Note Player',
      icon: 'play-square',
      factory: (controller, containerEl) => new PlaylistBasesView(controller, containerEl, this),
    });
    if (!basesViewRegistered) console.warn('[Note Player] Bases is disabled in this vault; playlist notes will not show the player view.');

    this.addRibbonIcon('play-square', 'Open note player', () => {
      void this.activateView();
    });

    registerCommands(this, {
      openView: () => this.activateView(),
      refreshLibrary: () => this.refresh(true),
      refreshBases: () => this.refreshCompanionBases(),
      convertPlaylistNotes: () => convertPlaylistNotes(this),
      addActiveNote: () => this.addActiveNoteToSelectedPlaylist(),
      loadActivePlaylist: () => this.activateActivePlaylist(),
      addTrackFromUrl: (input) => this.addTrackFromUrl(input),
      togglePlayback: () => this.togglePlayback(),
      playNext: () => this.playNext(),
      playPrevious: () => this.playPrevious(),
    });

    this.addSettingTab(new NotePlayerSettingsTab(this.app, this));
    this.registerVaultRefreshEvents();

    // Enabling mid-session (reload, update) runs this before Obsidian restores the existing leaf, which would duplicate the view.
    if (this.settings.autoOpenOnStartup && !this.app.workspace.layoutReady) {
      this.app.workspace.onLayoutReady(() => {
        void this.activateView();
      });
    }
  }

  onunload(): void {
    this.volume?.flush();
    this.volume = null;
    this.downloadStatusBar?.destroy();
    this.downloadStatusBar = null;
    this.playerSurface?.destroy();
    this.playerSurface = null;
    this.audioCacheService?.dispose();
    this.playerHostEl = null;
    this.scheduleRefresh.cancel();
  }

  async loadSettings(): Promise<void> {
    const loaded = await this.loadData() as Parameters<typeof normalizeSettings>[0] | null;
    this.settings = normalizeSettings(loaded ?? {});
  }

  async saveSettings(): Promise<void> {
    this.settings = normalizeSettings(this.settings);
    await this.saveData(this.settings);

    this.playerSurface?.setRepeatMode(this.settings.repeatMode);
    // Only a format change needs a new cache; replacing it otherwise orphans in-flight downloads.
    if (this.audioCacheService?.format === this.settings.audioFormat) return;
    const audioCache = this.createAudioCache();
    if (audioCache) {
      this.audioCacheService?.dispose();
      this.audioCacheService = audioCache;
      this.playerSurface?.setAudioCacheService(audioCache);
    }
  }

  private createAudioCache(): AudioCacheService | null {
    if (!this.vaultBasePath) return null;
    const pluginDir = this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
    const cache = new AudioCacheService(this.vaultBasePath, this.app.vault.adapter, this.settings.audioFormat, pluginDir);
    cache.onMeta = (videoId) => void this.importer.healTrack(videoId).finally(() => this.notifyChange());
    cache.onResolveChange = () => this.notifyChange();
    return cache;
  }

  getState(): PlaylistViewState {
    const selectedPlaylistPath = resolveSelectedPlaylistPath(this.settings.lastPlaylistPath, this.library.playlists);
    const selectedPlaylist =
      this.library.playlists.find((playlist) => playlist.path === selectedPlaylistPath) ?? null;
    const queue = selectedPlaylist?.tracks.map(toPlaylistTrack) ?? [];
    const currentTrack = this.playback.resolveCurrentTrack(queue, this.library.tracks, toPlaylistTrack);

    return {
      errorMessage: this.errorMessage,
      playlists: this.library.playlists.map(toPlaylistSummary),
      selectedPlaylistPath,
      queue,
      library: this.library.tracks.map(toPlaylistTrack),
      currentTrack,
      autoplayEnabled: this.settings.autoplayEnabled,
      startPlayback: this.playIntent || this.settings.autoplayEnabled,
      playbackState: this.viewPlaybackState,
      repeatMode: this.settings.repeatMode,
      turntableSounds: this.settings.turntableSounds,
      turntableStyle: this.settings.turntableStyle,
      pendingImports: this.importer.getPending(),
      loadingTitles: this.loadingTitles(queue, currentTrack),
    };
  }

  /** A bare-id track is loading only while its resolve or heal is in flight; play starts the resolve synchronously via prefetchNext. */
  private loadingTitles(queue: PlaylistTrack[], current: PlaylistTrack | null): Set<string> {
    const cache = this.audioCacheService;
    const ids = new Set<string>();
    if (!cache) return ids;
    for (const track of current ? [...queue, current] : queue) {
      if (!isUnavailable(track)) continue;
      if (cache.isResolving(track.videoId) || this.importer.isHealing(track.videoId)) ids.add(track.videoId);
    }
    return ids;
  }

  subscribe(callback: () => void): () => void {
    this.changeListeners.add(callback);
    return () => {
      this.changeListeners.delete(callback);
    };
  }

  onStateChange(callback: () => void): () => void {
    return this.subscribe(callback);
  }

  getPlaylistByPath(path: string): PlaylistNote | null {
    return this.library.playlists.find((playlist) => playlist.path === path) ?? null;
  }

  async playPlaylist(companionPath: string, startTrackPath: string | null): Promise<void> {
    const playlist = this.getPlaylistByPath(companionPath);
    if (!playlist) {
      showNotice('playlist_missing');
      return;
    }
    await this.selectPlaylist(companionPath);
    const path = startTrackPath ?? playlist.trackPaths[0];
    if (path && playlist.trackPaths.includes(path)) await this.playTrack(path);
  }

  async refresh(notify = false): Promise<void> {
    await this.refreshIndex();

    if (notify) {
      showNotice('library_refreshed', {
        tracks: plural(this.library.tracks.length, 'track'),
        playlists: plural(this.library.playlists.length, 'playlist'),
      });
    }
  }

  async refreshCompanionBases(): Promise<void> {
    await writeCompanionBaseFiles(this.app, this.settings, true);
  }

  async selectPlaylist(path: string | null): Promise<void> {
    this.settings.lastPlaylistPath = path;
    await this.saveSettings();
    this.notifyChange();
  }

  async selectActivePlaylist(): Promise<void> {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      showNotice('active_note_not_playlist');
      return;
    }

    const playlist = this.library.playlists.find((entry) => entry.path === activeFile.path);
    if (!playlist) {
      showNotice('active_note_not_playlist');
      return;
    }

    await this.selectPlaylist(playlist.path);
    showNotice('playlist_loaded', { name: playlist.title });
  }

  async createPlaylist(name: string): Promise<void> {
    const path = await this.playlists.createPlaylist(name);
    await this.openPlaylist(path);
  }
  togglePlayback(): Promise<void> {
    if (this.viewPlaybackState === 'playing' || this.viewPlaybackState === 'loading') {
      this.playerSurface?.pause();
      return Promise.resolve();
    }
    const queue = this.selectedPlaylist()?.trackPaths ?? [];
    const path = queue.find((path) => path === this.playback.currentTrackPath) ?? queue[0];
    if (!path) {
      showNotice('playlist_missing');
      return Promise.resolve();
    }
    return this.playTrack(path);
  }

  playTrack(path: string): Promise<void> {
    this.playIntent = true;
    const selected = this.selectedPlaylist();
    if (selected?.trackPaths.includes(path)) this.playingPlaylistPath = selected.path;
    // The surface keeps the loaded track, so re-rendering it would not resume a paused one.
    if (path === this.playback.currentTrackPath && this.playerSurface?.play()) return Promise.resolve();
    this.playback.play(path, this.library.tracks);
    this.notifyChange();
    void this.prefetchNext();
    return Promise.resolve();
  }

  playPrevious(): Promise<void> {
    if (this.playback.previous(this.currentQueue())) {
      this.playingPlaylistPath ??= this.selectedPlaylist()?.path ?? null;
      this.playIntent = true;
      this.notifyChange();
      void this.prefetchNext();
    }
    return Promise.resolve();
  }

  /** `explicit` is false when a track ends on its own, so autoplay alone decides whether the next one starts. */
  playNext(explicit = true): Promise<void> {
    if (this.playback.next(this.currentQueue())) {
      this.playingPlaylistPath ??= this.selectedPlaylist()?.path ?? null;
      this.playIntent = explicit;
      this.notifyChange();
      void this.prefetchNext();
    }
    return Promise.resolve();
  }

  async addTrackToPlaylist(trackPath: string): Promise<void> {
    const playlistPath = resolveSelectedPlaylistPath(this.settings.lastPlaylistPath, this.library.playlists);
    if (!playlistPath) {
      showNotice('playlist_missing');
      return;
    }

    await this.playlists.addTracks(playlistPath, [trackPath]);
    if (!this.playback.currentTrackPath) {
      this.playback.currentTrackPath = trackPath;
      this.notifyChange();
    }
  }

  addTrackFromUrl(input: string): Promise<void> {
    return this.importer.importFromInput(input);
  }

  async addActiveNoteToPlaylist(): Promise<void> {
    await this.addActiveNoteToSelectedPlaylist();
  }

  async removeTrackFromPlaylist(trackPath: string): Promise<void> {
    const playlistPath = resolveSelectedPlaylistPath(this.settings.lastPlaylistPath, this.library.playlists);
    if (!playlistPath) {
      showNotice('playlist_missing');
      return;
    }

    const queueBefore = this.currentQueue().map((track) => track.path);
    await this.playlists.removeTrack(playlistPath, trackPath);
    if (this.playback.currentTrackPath === trackPath) {
      // A paused track's replacement must not start just because an earlier play left the intent set.
      this.playIntent = this.viewPlaybackState === 'playing' || this.viewPlaybackState === 'loading';
      this.playback.currentTrackPath = successorAfterRemoval(queueBefore, trackPath);
      this.notifyChange();
    }
  }

  openNote(path: string): Promise<void> {
    return openNoteInTab(this.app, path);
  }

  openPlaylist(path: string): Promise<void> {
    return openNoteInTab(this.app, path);
  }

  async openBase(kind: 'music' | 'playlists'): Promise<void> {
    await openCompanionBase(this.app, this.settings, kind === 'music' ? MUSIC_BASE_NAME : PLAYLISTS_BASE_NAME);
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

  getPeaksStore(): PeaksStore | null {
    const cache = this.audioCacheService;
    if (!cache) return null;
    const cacheDir = `${this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`}/audio-cache`;
    this.peaksStore ??= new PeaksStore(this.app.vault.adapter, cacheDir, (id) => `${cacheDir}/${id}.${this.settings.audioFormat}`);
    return this.peaksStore;
  }

  getThumbnailCache(): ThumbnailCacheService | null {
    return this.thumbnailCache;
  }

  getAudioCacheService(): AudioCachePort | null {
    return this.audioCacheService;
  }

  async setAutoplayEnabled(enabled: boolean): Promise<void> {
    this.settings.autoplayEnabled = enabled;
    await this.saveSettings();
    this.notifyChange();
  }

  private async activateView(): Promise<void> {
    const existing = [
      ...this.app.workspace.getLeavesOfType(VIEW_TYPE_NOTE_PLAYER),
      ...this.app.workspace.getLeavesOfType(VIEW_TYPE_LEGACY),
    ];
    if (existing.length > 0) {
      void this.app.workspace.revealLeaf(existing[0]!);
      return;
    }

    const leaf = this.app.workspace.getLeaf('tab');
    await leaf.setViewState({ type: VIEW_TYPE_NOTE_PLAYER, active: true });
    void this.app.workspace.revealLeaf(leaf);
  }

  private registerVaultRefreshEvents(): void {
    const { metadataCache, vault } = this.app;
    const schedule = () => this.scheduleRefresh();
    this.registerEvent(metadataCache.on('changed', schedule));
    this.registerEvent(metadataCache.on('resolved', schedule));
    this.registerEvent(vault.on('rename', schedule));
    this.registerEvent(vault.on('delete', schedule));
    this.registerEvent(vault.on('create', schedule));
    this.registerEvent(vault.on('modify', (file) => {
      if (file.path.endsWith('.base')) schedule();
    }));
  }

  // Keep the existing view visible while paired base configs load.
  private async refreshIndex(): Promise<void> {
    const generation = ++this.refreshGeneration;
    this.errorMessage = null;
    try {
      const notes = collectNoteSnapshots(this.app, [this.settings.musicFolder, this.settings.playlistFolder], this.settings);
      const baseConfigs = await collectBaseConfigs(this.app, notes, this.settings.playlistNoteType);
      if (generation !== this.refreshGeneration) return;
      this.library = buildMusicLibrary(notes, this.settings, baseConfigs);

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
      if (generation !== this.refreshGeneration) return;
      this.errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[Note Player] Failed to refresh library', error);
    } finally {
      if (generation === this.refreshGeneration) this.notifyChange();
    }
  }

  private async activateActivePlaylist(): Promise<void> {
    await this.selectActivePlaylist();
    await this.activateView();
  }

  private async addActiveNoteToSelectedPlaylist(): Promise<void> {
    const playlistPath = resolveSelectedPlaylistPath(this.settings.lastPlaylistPath, this.library.playlists);
    if (!playlistPath) {
      showNotice('playlist_missing');
      return;
    }

    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      showNotice('active_note_not_music');
      return;
    }

    const track = this.library.tracks.find((entry) => entry.path === activeFile.path);
    if (!track) {
      showNotice('active_note_not_music');
      return;
    }

    await this.playlists.addTracks(playlistPath, [track.path]);
  }

  private selectedPlaylist(): PlaylistNote | null {
    const selectedPlaylistPath = resolveSelectedPlaylistPath(this.settings.lastPlaylistPath, this.library.playlists);
    return this.library.playlists.find((playlist) => playlist.path === selectedPlaylistPath) ?? null;
  }

  // Next/previous follow the playlist the track was started from, not the one being browsed.
  private currentQueue(): PlaylistTrack[] {
    const playing = this.library.playlists.find((playlist) => playlist.path === this.playingPlaylistPath);
    return (playing ?? this.selectedPlaylist())?.tracks.map(toPlaylistTrack) ?? [];
  }

  /** Warms the next track's stream URL so Next and auto-advance skip the yt-dlp round trip. */
  private async prefetchNext(): Promise<void> {
    const cache = this.audioCacheService;
    const queue = this.currentQueue();
    const index = queue.findIndex((track) => track.path === this.playback.currentTrackPath);
    // A bare-id track playing from cached audio never resolves a stream, so resolve once to learn its title.
    const current = this.library.tracks.find((track) => track.path === this.playback.currentTrackPath);
    if (current && isUnavailable(current) && cache?.isAvailable()) cache.prefetchStream(current.videoId);
    const next = index >= 0 ? queue[index + 1] : undefined;
    if (!cache?.prefetchStream || !next?.videoId || !cache.isAvailable()) return;
    if (!(await cache.hasCached(next.videoId))) cache.prefetchStream(next.videoId);
  }

  private syncStatusBar(): void {
    const track = this.viewPlaybackState === 'idle' ? null : this.getState().currentTrack;
    this.downloadStatusBar?.setNowPlaying(track ? trackLabel(track) : null, this.viewPlaybackState, !!track && this.getState().loadingTitles.has(track.videoId));
  }

  private notifyChange(): void {
    this.syncStatusBar();
    for (const listener of this.changeListeners) {
      listener();
    }
  }
}

