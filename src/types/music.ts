export interface MusicTrack {
  path: string;
  title: string;
  artist: string;
  sourceUrl: string;
  watchUrl: string;
  videoId: string;
  thumbnailUrl: string;
  tags: string[];
}

export interface PlaylistNote {
  path: string;
  basePath: string;
  title: string;
  coverUrl: string;
  description: string;
  trackPaths: string[];
  tracks: MusicTrack[];
}

export interface MusicLibrarySnapshot {
  tracks: MusicTrack[];
  playlists: PlaylistNote[];
}
