import type { NotePlayerSettings, YoutubePlaylistPropertyMapping } from '../types/settings';
import { dedupe } from '../utils/dedupe';

export const DEFAULT_PROPERTY_MAPPING: YoutubePlaylistPropertyMapping = {
  musicUrlProperties: ['source', 'youtube', 'youtube_url', 'url'],
  musicThumbnailProperties: ['image', 'thumbnail', 'cover'],
  musicArtistProperties: ['author', 'artist'],
  playlistTrackProperty: 'tracks',
  playlistDescriptionProperty: 'description',
  playlistCoverProperty: 'cover',
  musicNoteType: 'music',
  playlistNoteType: 'music-playlist',
};

export const DEFAULT_SETTINGS: NotePlayerSettings = {
  ...DEFAULT_PROPERTY_MAPPING,
  autoOpenOnStartup: false,
  playlistFolder: '90. System/Playlists',
  lastPlaylistPath: null,
  autoplayEnabled: true,
  audioFormat: 'mp3',
  repeatMode: 'none',
  debug: false,
};

export function normalizePropertyList(values: string[], fallback: string[]): string[] {
  const normalized = values
    .map((value) => value.trim())
    .filter(Boolean);

  return normalized.length > 0 ? dedupe(normalized) : [...fallback];
}

export function normalizePropertyName(value: string, fallback: string): string {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : fallback;
}

export function normalizeSettings(loaded: NotePlayerSettings): NotePlayerSettings {
  return {
    ...loaded,
    musicUrlProperties: normalizePropertyList(
      loaded.musicUrlProperties ?? [],
      DEFAULT_PROPERTY_MAPPING.musicUrlProperties,
    ),
    musicThumbnailProperties: normalizePropertyList(
      loaded.musicThumbnailProperties ?? [],
      DEFAULT_PROPERTY_MAPPING.musicThumbnailProperties,
    ),
    musicArtistProperties: normalizePropertyList(
      loaded.musicArtistProperties ?? [],
      DEFAULT_PROPERTY_MAPPING.musicArtistProperties,
    ),
    playlistTrackProperty: normalizePropertyName(
      loaded.playlistTrackProperty ?? '',
      DEFAULT_PROPERTY_MAPPING.playlistTrackProperty,
    ),
    playlistDescriptionProperty: normalizePropertyName(
      loaded.playlistDescriptionProperty ?? '',
      DEFAULT_PROPERTY_MAPPING.playlistDescriptionProperty,
    ),
    playlistCoverProperty: normalizePropertyName(
      loaded.playlistCoverProperty ?? '',
      DEFAULT_PROPERTY_MAPPING.playlistCoverProperty,
    ),
    musicNoteType: normalizePropertyName(
      loaded.musicNoteType ?? '',
      DEFAULT_PROPERTY_MAPPING.musicNoteType,
    ),
    playlistNoteType: normalizePropertyName(
      loaded.playlistNoteType ?? '',
      DEFAULT_PROPERTY_MAPPING.playlistNoteType,
    ),
  };
}

