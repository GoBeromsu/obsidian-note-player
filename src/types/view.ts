import type { PeaksStore } from '../services/peaks-store';
import type { PlaylistNote } from './music';
import type { PlaybackState, RepeatMode } from './playback';
import type { TurntableStyle } from './settings';

export type { TurntableStyle };

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
	thumbnailUrl: string;
	tags: string[];
}

export interface PendingImport {
	id: number;
	/** Null for playlist imports. */
	videoId: string | null;
	/** Filled once oEmbed answers (or times out to the placeholder). */
	title: string | null;
}

export interface PlaylistViewState {
	errorMessage: string | null;
	playlists: PlaylistSummary[];
	selectedPlaylistPath: string | null;
	queue: PlaylistTrack[];
	library: PlaylistTrack[];
	currentTrack: PlaylistTrack | null;
	autoplayEnabled: boolean;
	/** Whether the current track loads playing: after an explicit play, or whenever autoplay is on. */
	startPlayback: boolean;
	playbackState: PlaybackState;
	repeatMode: RepeatMode;
	turntableSounds: boolean;
	turntableStyle: TurntableStyle;
	pendingImports: readonly PendingImport[];
	/** Video ids whose title is still being fetched; they read as loading, not unavailable. */
	loadingTitles: ReadonlySet<string>;
}

/**
 * UI contract assumptions:
 * - state changes are pushed through subscribe()
 * - queue order follows the paired base's sort
 * - playNext()/playPrevious() update currentTrack in the next emitted state
 * - if setAutoplayEnabled is missing, the UI falls back to toggleAutoplay()
 * - if openBase() is missing, the UI simply hides base-navigation actions
 */
export interface PlaylistViewHost {
	getState(): PlaylistViewState;
	subscribe(onChange: () => void): () => void;
	onStateChange(onChange: () => void): () => void;
	getPlaylistByPath(path: string): PlaylistNote | null;
	playPlaylist(companionPath: string, startTrackPath: string | null): Promise<void>;
	refresh(notify?: boolean): Promise<void>;
	selectPlaylist(path: string | null): Promise<void>;
	selectActivePlaylist?(): Promise<void>;
	createPlaylist(name: string): Promise<void>;
	playTrack(path: string): Promise<void>;
	playPrevious(): Promise<void>;
	playNext(): Promise<void>;
	addTrackToPlaylist(path: string): Promise<void>;
	addActiveNoteToPlaylist?(): Promise<void>;
	addTrackFromUrl?(input: string): Promise<void>;
	removeTrackFromPlaylist(path: string): Promise<void>;
	openNote(path: string): Promise<void>;
	openPlaylist(path: string): Promise<void>;
	openBase?(kind: 'music' | 'playlists'): Promise<void>;
	refreshCompanionBases?(): Promise<void>;
	toggleAutoplay?(): Promise<void>;
	setAutoplayEnabled?(enabled: boolean): Promise<void>;
	toggleRepeatMode?(): Promise<void>;
	getAudioCacheService?(): AudioCachePort | null;
	getPeaksStore?(): PeaksStore | null;
	getThumbnailCache?(): ThumbnailCachePort | null;
}

/** `resolve` never blocks: a cache miss returns the remote URL and queues a download, then subscribers fire. */
export interface ThumbnailCachePort {
	resolve(videoId: string): string;
	subscribe(onChange: () => void): () => void;
	clear(): Promise<void>;
}

export interface VaultAdapter {
	exists(path: string): Promise<boolean>;
	getResourcePath(path: string): string;
	list(path: string): Promise<{ files: string[] }>;
	remove(path: string): Promise<void>;
}

export interface AudioCachePort {
	hasCached(videoId: string): Promise<boolean>;
	getFileUrl(videoId: string): string;
	download(videoId: string, onProgress: (percent: number) => void): Promise<string>;
	cancel(videoId: string): void;
	resolveStreamUrl?(videoId: string): Promise<string>;
	prefetchStream?(videoId: string): void;
	isResolving?(videoId: string): boolean;
	metaFor?(videoId: string): { title: string; author: string } | undefined;
	isAvailable(): boolean;
	checkAvailable(): Promise<boolean>;
	listPlaylist?(listId: string): Promise<string>;
}

export interface VaultWriter {
	readFile(path: string): Promise<string>;
	writeFile(path: string, content: string): Promise<void>;
	fileExists(path: string): boolean;
}
