import type { App, Component } from 'obsidian';
import { createPlaylistBaseContent } from '../domain/base-files';
import { createCompanionNoteContent, playlistFilePaths } from '../domain/playlist-files';
import { getPlaylistOrThrow } from '../domain/playlist-manager';
import { trackLabel } from '../domain/track-import';
import type { MusicLibrarySnapshot } from '../types/music';
import type { NotePlayerSettings } from '../types/settings';
import { linkDisplayText, parsePlaylistTrackReference, toObsidianWikilink } from '../utils/wikilink';
import { showNotice } from '../ui/notices';
import { ensureFolder, updateFrontmatter, waitForMetadata } from './vault-io';

interface PlaylistServiceHost {
  readonly app: App;
  readonly owner: Component;
  getSettings(): NotePlayerSettings;
  getLibrary(): MusicLibrarySnapshot;
  refresh(): Promise<void>;
  selectPlaylist(path: string): Promise<void>;
  saveSettings(): Promise<void>;
  invalidateRefresh(): void;
}

export class PlaylistService {
  playingPlaylistPath: string | null = null;
  private playlistEdits: Promise<void> = Promise.resolve();

  constructor(private readonly host: PlaylistServiceHost) {}

  followRename(path: string, oldPath: string, schedule: () => void): void {
    this.host.invalidateRefresh();
    const settings = this.host.getSettings();
    if (settings.lastPlaylistPath === oldPath) {
      settings.lastPlaylistPath = path;
      void this.host.saveSettings();
    }
    if (this.playingPlaylistPath === oldPath) this.playingPlaylistPath = path;
    schedule();
  }

  async createPlaylist(name: string): Promise<string> {
    const { app } = this.host;
    const settings = this.host.getSettings();
    const { notePath, basePath } = playlistFilePaths(
      settings.playlistFolder, name, (path) => !!app.vault.getAbstractFileByPath(path),
    );
    await ensureFolder(app, settings.playlistFolder);
    await app.vault.create(basePath, createPlaylistBaseContent(settings));
    const file = await app.vault.create(notePath, createCompanionNoteContent({
      noteType: settings.playlistNoteType,
      descriptionProperty: settings.playlistDescriptionProperty,
      coverProperty: settings.playlistCoverProperty,
      baseFileName: basePath.slice(basePath.lastIndexOf('/') + 1),
    }));
    await waitForMetadata(app, file);
    await this.host.refresh();
    await this.host.selectPlaylist(notePath);
    showNotice('playlist_created', { name: file.basename });
    return notePath;
  }

  addTracks(playlistPath: string, trackPaths: string[], notify = true): Promise<void> {
    return this.editMembership(playlistPath, { paths: trackPaths, add: true, notify });
  }

  removeTrack(playlistPath: string, trackPath: string): Promise<void> {
    return this.editMembership(playlistPath, { paths: [trackPath], add: false, notify: true });
  }

  /** Each edit reads the file's latest frontmatter, not the debounced library snapshot. */
  private editMembership(
    playlistPath: string,
    edit: { readonly paths: string[]; readonly add: boolean; readonly notify: boolean },
  ): Promise<void> {
    const run = this.playlistEdits.then(async () => {
      const { app } = this.host;
      const library = this.host.getLibrary();
      const playlist = getPlaylistOrThrow(playlistPath, library.playlists);
      const property = this.host.getSettings().playlistMembershipProperty;
      for (const path of new Set(edit.paths)) {
        await updateFrontmatter(this.host, path, (frontmatter) => {
          const current: unknown = frontmatter[property];
          const entries: unknown[] = Array.isArray(current) ? current : current == null ? [] : [current];
          const seen = new Set<string>();
          const members = entries.filter((entry) => {
            const reference = typeof entry === 'string' ? parsePlaylistTrackReference(entry) : null;
            const target = reference?.kind === 'wikilink'
              && app.metadataCache.getFirstLinkpathDest(reference.normalized, path)?.path;
            if (!target) return true;
            if (!edit.add && target === playlistPath) return false;
            if (seen.has(target)) return false;
            seen.add(target);
            return true;
          });
          if (edit.add && !seen.has(playlistPath)) members.push(toObsidianWikilink(playlistPath));
          frontmatter[property] = members;
        });
        if (edit.notify) {
          const track = library.tracks.find((entry) => entry.path === path);
          showNotice(edit.add ? 'track_added' : 'track_removed', {
            title: track ? trackLabel(track, true) : linkDisplayText(path, true), playlist: playlist.title,
          });
        }
      }
      await this.host.refresh();
    });
    // Keep later edits runnable after a caller has handled a failed write.
    this.playlistEdits = run.catch(() => undefined);
    return run;
  }
}
