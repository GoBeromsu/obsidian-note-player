import type { PlaybackState } from './playback';

export interface PlaylistSummary {
	path: string;
	title: string;
	trackCount: number;
	description?: string;
	coverImage?: string;
}

export interface PlaylistTrack {
	path: string;
	title: string;
	artist: string;
	sourceUrl: string;
	videoId: string;
	embedUrl: string;
	thumbnailUrl: string;
	tags: string[];
}

export interface PlaylistViewState {
	isLoading: boolean;
	errorMessage: string | null;
	playlists: PlaylistSummary[];
	selectedPlaylistPath: string | null;
	queue: PlaylistTrack[];
	library: PlaylistTrack[];
	currentTrack: PlaylistTrack | null;
	autoplayEnabled: boolean;
	playbackState: PlaybackState;
}

/**
 * UI contract assumptions:
 * - state changes are pushed through subscribe()
 * - queue order is persisted by moveTrackInPlaylist()
 * - playNext()/playPrevious() update currentTrack in the next emitted state
 * - if setAutoplayEnabled is missing, the UI falls back to toggleAutoplay()
 * - if openBase() is missing, the UI simply hides base-navigation actions
 */
export interface PlaylistViewHost {
	getState(): PlaylistViewState;
	subscribe(onChange: () => void): () => void;
	refresh(): Promise<void>;
	selectPlaylist(path: string | null): Promise<void>;
	selectActivePlaylist?(): Promise<void>;
	createPlaylist(name: string): Promise<void>;
	playTrack(path: string): Promise<void>;
	playPrevious(): Promise<void>;
	playNext(): Promise<void>;
	addTrackToPlaylist(path: string): Promise<void>;
	addActiveNoteToPlaylist?(): Promise<void>;
	removeTrackFromPlaylist(path: string): Promise<void>;
	moveTrackInPlaylist(fromIndex: number, toIndex: number): Promise<void>;
	openNote(path: string): Promise<void>;
	openPlaylist(path: string): Promise<void>;
	openBase?(kind: 'music' | 'playlists'): Promise<void>;
	refreshCompanionBases?(): Promise<void>;
	toggleAutoplay?(): Promise<void>;
	setAutoplayEnabled?(enabled: boolean): Promise<void>;
	getAudioCacheService?(): AudioCachePort | null;
}

export interface AudioCachePort {
	hasCached(videoId: string): boolean;
	getFileUrl(videoId: string): string;
	download(videoId: string, onProgress: (percent: number) => void): Promise<string>;
	cancel(videoId: string): void;
	isAvailable(): boolean;
}

export interface VaultWriter {
	readFile(path: string): Promise<string>;
	writeFile(path: string, content: string): Promise<void>;
	fileExists(path: string): boolean;
}
