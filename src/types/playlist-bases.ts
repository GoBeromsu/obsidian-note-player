import type { PlaylistNote } from './music';

/** What the Bases view needs from the plugin; app-free so the view depends on nothing in main.ts. */
export interface PlaylistBasesHost {
	getPlaylistByPath(path: string): PlaylistNote | null;
	playPlaylist(companionPath: string, startTrackPath: string | null): Promise<void>;
	getState(): { currentTrack: { path: string } | null };
	onStateChange(callback: () => void): () => void;
}

export interface PlaylistBasesRow {
	path: string;
	/** 1-based and zero-padded, matching the queue list. */
	order: string;
	title: string;
	artist: string;
	/** Fixed YouTube URL for the video id; null when the video is unavailable, so the placeholder shows instead. */
	thumbnailUrl: string | null;
	unavailable: boolean;
	current: boolean;
}
