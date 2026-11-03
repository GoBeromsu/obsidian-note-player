import { MarkdownView, requestUrl, type App, type TFile } from 'obsidian';
import { plural } from '../utils/plural';
import { getLegacyPlaylistTrackProperty } from '../domain/config';
import {
  buildMusicFrontmatter, classifyBacklinks, classifyImport, isUnavailable, parseFlatPlaylistOutput, parseOembed, trackLabel, type TrackMeta,
} from '../domain/track-import';
import type { MusicLibrarySnapshot } from '../types/music';
import type { NotePlayerSettings } from '../types/settings';
import type { AudioCachePort, PendingImport } from '../types/view';
import { sanitizeFileName } from '../utils/dedupe';
import { parsePlaylistTrackReference, toObsidianWikilink } from '../utils/wikilink';
import { retryUntil } from '../utils/retry';
import { withTimeout } from '../utils/timeout';
import { buildYoutubeWatchUrl, parseYoutubeUrl } from '../utils/youtube';
import { showNotice } from '../ui/notices';
import { ensureFolder, getAvailablePath, waitForMetadata } from './vault-io';

const INBOX_NAME = 'Inbox';
const OEMBED_TIMEOUT_MS = 5000;
const OEMBED_RETRY_DELAY_MS = 400;

export interface TrackImporterDeps {
  app: App;
  getSettings(): NotePlayerSettings;
  getLibrary(): MusicLibrarySnapshot;
  getSelectedPlaylistPath(): string | null;
  getAudioCache(): AudioCachePort | null;
  createPlaylist(name: string): Promise<string>;
  addTracks(playlistPath: string, trackPaths: string[]): Promise<void>;
  /** Starts the track unless something is already playing. */
  playIfIdle(trackPath: string): void;
  onPendingChange(): void;
  /** Called before a note is renamed, so playback can follow it to the new path. */
  onTrackRename(from: string, to: string): void;
}

export class TrackImporter {
  private queue: Promise<void> = Promise.resolve();
  private pending: PendingImport[] = [];
  private nextPendingId = 0;
  /** Videos added since the queue last drained; one paste of several links gets a single notice. */
  private added: Array<{ title: string; playlist: string }> = [];
  private readonly healing = new Set<string>();

  constructor(private readonly deps: TrackImporterDeps) {}

  /** Imports waiting or running, in paste order; the view shows each as a placeholder row. */
  getPending(): readonly PendingImport[] {
    return this.pending;
  }

  async importFromInput(input: string): Promise<void> {
    const target = parseYoutubeUrl(input);
    if (!target) {
      showNotice('invalid_youtube_url');
      return;
    }
    const id = this.nextPendingId++;
    this.setPending([...this.pending, { id, videoId: target.kind === 'video' ? target.videoId : null, title: null }]);
    // Imports run one at a time so a second paste waits instead of being dropped.
    const run = this.queue
      .then(() => target.kind === 'video'
        ? this.importVideo(target.videoId, id)
        : this.importPlaylist(target.listId))
      .finally(() => {
        this.setPending(this.pending.filter((entry) => entry.id !== id));
        if (this.pending.length === 0) this.announceAdded();
      });
    this.queue = run.catch(() => undefined);
    await run;
  }

  private announceAdded(): void {
    const added = this.added;
    this.added = [];
    const last = added[added.length - 1];
    if (!last) return;
    if (added.length === 1) showNotice('track_added', last);
    else showNotice('tracks_imported', { tracks: plural(added.length, 'video'), playlist: last.playlist });
  }

  private setPending(next: PendingImport[]): void {
    this.pending = next;
    this.deps.onPendingChange();
  }

  private async importVideo(videoId: string, pendingId: number): Promise<void> {
    const playlistPath = this.deps.getSelectedPlaylistPath() ?? await this.deps.createPlaylist(INBOX_NAME);
    const playlist = this.playlistOf(playlistPath);
    const plan = classifyImport(videoId, this.deps.getLibrary().tracks, playlist.trackPaths);

    if (plan.action === 'already-in-playlist') {
      showNotice('track_already_in_playlist', { title: this.titleOf(plan.path), playlist: playlist.title });
      this.deps.playIfIdle(plan.path);
      return;
    }

    // Resolve the stream while oEmbed and the note write run, so the first play skips yt-dlp's round trip.
    const cache = this.deps.getAudioCache();
    if (cache?.isAvailable()) cache.prefetchStream?.(videoId);

    let trackPath: string;
    let title: string;
    if (plan.action === 'reuse') {
      trackPath = plan.path;
      title = this.titleOf(plan.path, true);
    } else {
      const meta = await this.fetchMeta(videoId);
      title = meta.title;
      this.setPending(this.pending.map((entry) => entry.id === pendingId ? { ...entry, title } : entry));
      const file = await this.createTrackNote(meta);
      await waitForMetadata(this.deps.app, file);
      trackPath = file.path;
    }
    await this.deps.addTracks(playlistPath, [trackPath]);
    this.added.push({ title: title === videoId ? 'unavailable video' : title, playlist: playlist.title });
    this.deps.playIfIdle(trackPath);
    void this.healTrack(videoId);
  }

  isHealing(videoId: string): boolean {
    return this.healing.has(videoId);
  }

  /** Gives a track saved under its bare id the title and artist yt-dlp reported; quiet, no notice. */
  async healTrack(videoId: string): Promise<void> {
    const { app } = this.deps;
    const meta = this.deps.getAudioCache()?.metaFor?.(videoId);
    const track = this.deps.getLibrary().tracks.find((entry) => entry.videoId === videoId);
    if (!meta?.title || !track || !isUnavailable(track) || this.healing.has(videoId)) return;
    const file = app.vault.getFileByPath(track.path);
    if (!file) return;
    this.healing.add(videoId);
    try {
      // Renaming under unsaved editor text could lose it; the next stream resolve heals the track instead.
      if (await this.hasUnsavedEdits(file)) return;
      const title = sanitizeFileName(meta.title, 'Untitled track');
      const links = this.playlistsLinking(file);
      // Other notes link here by name; renaming would break them (or ask the user), so the title goes into metadata.
      if (links.elsewhere) title !== file.basename && await this.writeMeta(file, meta, true);
      else {
        if (title !== file.basename) await this.renameTrack(file, getAvailablePath(app, file.parent?.path ?? '', title), links.playlists);
        await this.writeMeta(file, meta, false);
      }
      await this.libraryHealed(videoId);
    } catch (error) {
      console.error('Note Player title heal failed', error);
    } finally {
      this.healing.delete(videoId);
    }
  }

  /** The debounced index trails the write; keep the track reading as loading until it shows the new title. */
  private async libraryHealed(videoId: string): Promise<void> {
    for (let waited = 0; waited < 1500; waited += 50) {
      const track = this.deps.getLibrary().tracks.find((entry) => entry.videoId === videoId);
      if (!track || !isUnavailable(track)) return;
      await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
    }
  }

  private async writeMeta(file: TFile, meta: { title: string; author: string }, withTitle: boolean): Promise<void> {
    const artistProperty = this.deps.getSettings().musicArtistProperty;
    const writeArtist = artistProperty.trim() !== '' && meta.author !== '';
    if (!withTitle && !writeArtist) return;
    await this.deps.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
      if (withTitle) frontmatter.title = meta.title;
      if (writeArtist) frontmatter[artistProperty] = meta.author;
    });
  }

  /** vault.rename never prompts; the playlists that linked the note are relinked by hand. */
  private async renameTrack(file: TFile, target: string, playlists: Map<string, Set<string>>): Promise<void> {
    const from = file.path;
    this.deps.onTrackRename(from, target);
    try {
      await this.deps.app.vault.rename(file, target);
    } catch (error) {
      this.deps.onTrackRename(target, from);
      throw error;
    }
    await this.relink(playlists, file);
  }

  /** Playlist entries that resolve to `file`, keyed by playlist path, and whether any other note links to it. */
  private playlistsLinking(file: TFile): { playlists: Map<string, Set<string>>; elsewhere: boolean } {
    const { app } = this.deps;
    const property = getLegacyPlaylistTrackProperty(this.deps.getSettings());
    const playlistPaths = new Set(this.deps.getLibrary().playlists.map((playlist) => playlist.path));
    const { playlistSources, elsewhere } = classifyBacklinks(app.metadataCache.resolvedLinks, file.path, playlistPaths);
    const playlists = new Map<string, Set<string>>();
    for (const source of playlistSources) {
      const entries: unknown = app.metadataCache.getCache(source)?.frontmatter?.[property];
      const own = (Array.isArray(entries) ? entries : []).filter((entry): entry is string => {
        const reference = typeof entry === 'string' ? parsePlaylistTrackReference(entry) : null;
        return reference !== null && app.metadataCache.getFirstLinkpathDest(reference.normalized, source) === file;
      });
      playlists.set(source, new Set(own));
    }
    return { playlists, elsewhere };
  }

  private async relink(playlists: Map<string, Set<string>>, file: TFile): Promise<void> {
    const { app } = this.deps;
    const property = getLegacyPlaylistTrackProperty(this.deps.getSettings());
    for (const [path, entries] of playlists) {
      const playlist = app.vault.getFileByPath(path);
      if (!playlist) continue;
      await app.fileManager.processFrontMatter(playlist, (frontmatter: Record<string, unknown>) => {
        const current: unknown = frontmatter[property];
        if (!Array.isArray(current)) return;
        frontmatter[property] = current.map((entry: unknown) => typeof entry === 'string' && entries.has(entry) ? toObsidianWikilink(file.path) : entry);
      });
    }
  }

  /** An editor holding text the file does not have yet must not have its note renamed under it. */
  private async hasUnsavedEdits(file: TFile): Promise<boolean> {
    const { app } = this.deps;
    const saved = await app.vault.cachedRead(file);
    return app.workspace.getLeavesOfType('markdown')
      .some((leaf) => leaf.view instanceof MarkdownView && leaf.view.file === file && leaf.view.getViewData() !== saved);
  }

  private async importPlaylist(listId: string): Promise<void> {
    const cache = this.deps.getAudioCache();
    if (!cache || !(await cache.checkAvailable()) || typeof cache.listPlaylist !== 'function') {
      showNotice('ytdlp_unavailable');
      return;
    }
    const flat = parseFlatPlaylistOutput(await cache.listPlaylist(listId));
    if (flat.entries.length === 0) {
      showNotice('invalid_youtube_url');
      return;
    }

    const playlistPath = this.deps.getSelectedPlaylistPath()
      ?? await this.deps.createPlaylist(flat.title || INBOX_NAME);
    const playlist = this.playlistOf(playlistPath);
    const known: Array<{ path: string; videoId: string }> = [...this.deps.getLibrary().tracks];
    const paths: string[] = [];
    let lastCreated: TFile | null = null;

    for (const entry of flat.entries) {
      const plan = classifyImport(entry.videoId, known, [...playlist.trackPaths, ...paths]);
      if (plan.action === 'already-in-playlist') continue;
      if (plan.action === 'reuse') {
        paths.push(plan.path);
        continue;
      }
      lastCreated = await this.createTrackNote(entry);
      known.push({ path: lastCreated.path, videoId: entry.videoId });
      paths.push(lastCreated.path);
    }

    if (lastCreated) await waitForMetadata(this.deps.app, lastCreated);
    if (paths.length === 0) {
      showNotice('track_already_in_playlist', { title: flat.title || listId, playlist: playlist.title });
      return;
    }
    await this.deps.addTracks(playlistPath, paths);
    showNotice('tracks_imported', { tracks: plural(paths.length, 'track'), playlist: playlist.title });
    this.deps.playIfIdle(paths[0]!);
  }

  private async fetchMeta(videoId: string): Promise<TrackMeta> {
    const fallback: TrackMeta = {
      videoId,
      title: videoId,
      author: '',
    };
    const watchUrl = buildYoutubeWatchUrl(videoId);
    // A slow or unreachable oEmbed must not hold up the import; the bare id stands in as the title until yt-dlp heals it.
    const oembed = await retryUntil(() => withTimeout(
      requestUrl({
        url: `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watchUrl)}`,
        throw: false,
      }).then((response) => response.status === 200 ? parseOembed(response.json) : null),
      OEMBED_TIMEOUT_MS,
      null,
    ), 2, OEMBED_RETRY_DELAY_MS);
    return oembed ? { videoId, ...oembed } : fallback;
  }

  private async createTrackNote(meta: TrackMeta): Promise<TFile> {
    const { app } = this.deps;
    const settings = this.deps.getSettings();
    const folder = settings.musicFolder || app.fileManager.getNewFileParent('').path;
    await ensureFolder(app, folder);
    const path = getAvailablePath(app, folder, sanitizeFileName(meta.title, 'Untitled track'));
    const file = await app.vault.create(path, `![](${buildYoutubeWatchUrl(meta.videoId)})\n`);
    await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
      Object.assign(frontmatter, buildMusicFrontmatter(meta, settings));
    });
    return file;
  }

  private playlistOf(path: string) {
    const playlist = this.deps.getLibrary().playlists.find((entry) => entry.path === path);
    if (!playlist) throw new Error(`Playlist not found: ${path}`);
    return playlist;
  }

  private titleOf(trackPath: string, midSentence = false): string {
    const track = this.deps.getLibrary().tracks.find((entry) => entry.path === trackPath);
    return track ? trackLabel(track, midSentence) : trackPath;
  }
}
