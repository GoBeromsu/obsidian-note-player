import type { NotePlayerSettings, YoutubePlaylistPropertyMapping } from '../types/settings';
import { DEFAULT_VOLUME, normalizeVolume } from './volume';

export const LEGACY_TRACKS_KEY = 'tracks';
export const VAULT_ROOT = '/';

export const DEFAULT_PROPERTY_MAPPING = {
  musicUrlProperty: 'source',
  musicThumbnailProperty: 'image',
  musicArtistProperty: 'author',
  playlistMembershipProperty: 'playlists',
  playlistDescriptionProperty: 'description',
  playlistCoverProperty: 'cover',
  musicNoteType: 'music',
  playlistNoteType: 'music-playlist',
} satisfies YoutubePlaylistPropertyMapping;

export const DEFAULT_SETTINGS: NotePlayerSettings = {
  ...DEFAULT_PROPERTY_MAPPING,
  autoOpenOnStartup: false,
  playlistFolder: '90. System/Playlists',
  musicFolder: '',
  turntableSounds: true,
  turntableStyle: 'realistic',
  lastPlaylistPath: null,
  autoplayEnabled: true,
  audioFormat: 'mp3',
  repeatMode: 'none',
  volume: DEFAULT_VOLUME.level,
  volumeMuted: DEFAULT_VOLUME.muted,
};

function normalizePropertyName(value: unknown, fallback: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized.length > 0 ? normalized : fallback;
}

type MappingKey = keyof typeof DEFAULT_PROPERTY_MAPPING;
type LegacyKey = 'musicUrlProperties' | 'musicThumbnailProperties' | 'musicArtistProperties' | 'playlistTrackProperty';
type SavedSettings = Partial<Omit<NotePlayerSettings, keyof YoutubePlaylistPropertyMapping>>
  & Partial<Record<keyof YoutubePlaylistPropertyMapping | LegacyKey, unknown>>;

function isMappingKey(key: string): key is MappingKey {
  return Object.hasOwn(DEFAULT_PROPERTY_MAPPING, key);
}

export function normalizeSettingValue(key: string, value: unknown): unknown {
  return isMappingKey(key)
    ? normalizePropertyName(value, DEFAULT_PROPERTY_MAPPING[key])
    : typeof value === 'string' ? value.trim() : value;
}

function migrateProperty(loaded: SavedSettings, key: MappingKey, legacy: unknown): string {
  const values: readonly unknown[] = Array.isArray(legacy) ? legacy : [];
  const value = Object.hasOwn(loaded, key) ? loaded[key]
    : values.find((entry) => typeof entry === 'string' && entry.trim());
  return normalizePropertyName(value, DEFAULT_PROPERTY_MAPPING[key]);
}

/** Temporary track-list access until playlist storage moves to membership links. */
export function getLegacyPlaylistTrackProperty(mapping: YoutubePlaylistPropertyMapping): string {
  return normalizePropertyName(mapping.legacyPlaylistTrackProperty, LEGACY_TRACKS_KEY);
}

export function normalizeSettings(loaded: SavedSettings = {}): NotePlayerSettings {
  const {
    musicUrlProperties, musicThumbnailProperties, musicArtistProperties, playlistTrackProperty,
    legacyPlaylistTrackProperty, ...settings
  } = loaded;
  const legacy = ['musicUrlProperties', 'musicThumbnailProperties', 'musicArtistProperties', 'playlistTrackProperty']
    .some((key) => Object.hasOwn(loaded, key));
  const volume = normalizeVolume(loaded.volume, loaded.volumeMuted);
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    volume: volume.level,
    volumeMuted: volume.muted,
    turntableStyle: loaded.turntableStyle === 'minimal' ? 'minimal' : 'realistic',
    musicUrlProperty: migrateProperty(loaded, 'musicUrlProperty', musicUrlProperties),
    musicThumbnailProperty: migrateProperty(loaded, 'musicThumbnailProperty', musicThumbnailProperties),
    musicArtistProperty: migrateProperty(loaded, 'musicArtistProperty', musicArtistProperties),
    playlistMembershipProperty: normalizePropertyName(
      loaded.playlistMembershipProperty,
      DEFAULT_PROPERTY_MAPPING.playlistMembershipProperty,
    ),
    playlistDescriptionProperty: normalizePropertyName(
      loaded.playlistDescriptionProperty,
      DEFAULT_PROPERTY_MAPPING.playlistDescriptionProperty,
    ),
    playlistCoverProperty: normalizePropertyName(
      loaded.playlistCoverProperty,
      DEFAULT_PROPERTY_MAPPING.playlistCoverProperty,
    ),
    musicNoteType: normalizePropertyName(
      loaded.musicNoteType,
      DEFAULT_PROPERTY_MAPPING.musicNoteType,
    ),
    playlistNoteType: normalizePropertyName(
      loaded.playlistNoteType,
      DEFAULT_PROPERTY_MAPPING.playlistNoteType,
    ),
    ...(legacy || legacyPlaylistTrackProperty !== undefined ? {
      legacyPlaylistTrackProperty: normalizePropertyName(
        legacyPlaylistTrackProperty ?? playlistTrackProperty, LEGACY_TRACKS_KEY,
      ),
    } : {}),
  };
}

