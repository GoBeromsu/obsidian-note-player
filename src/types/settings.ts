export interface YoutubePlaylistPropertyMapping {
  musicUrlProperty: string;
  musicThumbnailProperty: string;
  musicArtistProperty: string;
  playlistMembershipProperty: string;
  playlistDescriptionProperty: string;
  playlistCoverProperty: string;
  musicNoteType: string;
  playlistNoteType: string;
  legacyPlaylistTrackProperty?: string;
}

import type { AudioFormat } from './audio';
import type { RepeatMode } from './playback';

export type TurntableStyle = 'realistic' | 'minimal';

export interface NotePlayerSettings extends YoutubePlaylistPropertyMapping {
  autoOpenOnStartup: boolean;
  playlistFolder: string;
  musicFolder: string;
  turntableSounds: boolean;
  turntableStyle: TurntableStyle;
  lastPlaylistPath: string | null;
  autoplayEnabled: boolean;
  audioFormat: AudioFormat;
  repeatMode: RepeatMode;
  volume: number;
  volumeMuted: boolean;
}
