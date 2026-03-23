export interface MusicTrack {
  path: string;
  title: string;
  artist: string;
  sourceUrl: string;
  watchUrl: string;
  embedUrl: string;
  videoId: string;
  thumbnailUrl: string;
  imageUrl: string;
  tags: string[];
}

export interface PlaylistNote {
  path: string;
  title: string;
  coverUrl: string;
  description: string;
  trackPaths: string[];
  tracks: MusicTrack[];
  missingTrackPaths: string[];
}

export interface MusicLibrarySnapshot {
  tracks: MusicTrack[];
  playlists: PlaylistNote[];
}
