export interface YoutubePlaylistPropertyMapping {
  musicUrlProperties: string[];
  musicThumbnailProperties: string[];
  musicArtistProperties: string[];
  playlistTrackProperty: string;
  playlistDescriptionProperty: string;
  playlistCoverProperty: string;
  musicNoteType: string;
  playlistNoteType: string;
}

import type { AudioFormat } from './audio';

export interface NotePlayerSettings extends YoutubePlaylistPropertyMapping {
  autoOpenOnStartup: boolean;
  playlistFolder: string;
  lastPlaylistPath: string | null;
  autoplayEnabled: boolean;
  audioFormat: AudioFormat;
  debug: boolean;
  plugin_notices?: { muted: Record<string, boolean> };
}
