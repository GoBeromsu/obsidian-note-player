import type { AudioCachePort } from '../../types/view';
import type { PlaylistTrack } from '../../types/view';
import type { PlaybackState, RepeatMode } from '../../types/playback';

export type { PlaybackState };

export function formatTime(seconds: number): string {
	const s = Math.floor(seconds);
	const mins = Math.floor(s / 60);
	const secs = s % 60;
	return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export class PlayerSurface {
	private currentVideoId: string | null = null;
	private currentAutoplay = false;
	private host: HTMLElement;
	private audioElement: HTMLAudioElement | null = null;
	private audioCacheService: AudioCachePort | null = null;
	private suppressCallbacks = false;
	private isDownloading = false;
	private downloadToken = 0;
	private downloadCancelled = false;
	private repeatMode: RepeatMode = 'none';

	onDownloadProgress: ((percent: number, error?: string) => void) | null = null;

	constructor(
		host: HTMLElement,
		private readonly onEnded: () => Promise<void>,
		private readonly onPlaybackChange: (playbackState: PlaybackState) => void,
	) {
		this.host = host;
	}

	setAudioCacheService(service: AudioCachePort): void {
		this.audioCacheService = service;
	}

	setRepeatMode(mode: RepeatMode): void {
		this.repeatMode = mode;
	}

	async render(track: PlaylistTrack, autoplayEnabled: boolean): Promise<void> {
		if (this.currentVideoId === track.videoId && (this.audioElement || this.isDownloading)) return;

		// Cancel any in-flight download for a different track and invalidate its callbacks
		if (this.currentVideoId && this.currentVideoId !== track.videoId) {
			this.downloadToken++; // immediately invalidate stale callbacks
			this.audioCacheService?.cancel(this.currentVideoId);
		}

		this.silentPauseAudio();
		this.audioElement = null;

		if (!this.audioCacheService) {
			this.renderUnavailable();
			return;
		}

		const videoId = track.videoId;

		if (await this.audioCacheService.hasCached(videoId)) {
			this.mountAudio(this.audioCacheService.getFileUrl(videoId), autoplayEnabled);
			this.activateTrack(videoId, autoplayEnabled);
			return;
		}

		this.currentVideoId = videoId;
		this.currentAutoplay = autoplayEnabled;
		this.isDownloading = true;
		const token = ++this.downloadToken;
		this.onPlaybackChange('paused');
		this.onDownloadProgress?.(0);

		try {
			await this.audioCacheService.download(videoId, (percent) => {
				if (token !== this.downloadToken) return;
				this.onDownloadProgress?.(percent);
			});
			if (token !== this.downloadToken) return;
			this.onDownloadProgress?.(100);
			this.mountAudio(this.audioCacheService.getFileUrl(videoId), autoplayEnabled);
			this.activateTrack(videoId, autoplayEnabled);
		} catch (e) {
			if (token !== this.downloadToken) return;
			if (!this.downloadCancelled) {
				const reason = e instanceof Error ? e.message : String(e);
				this.onDownloadProgress?.(-1, reason);
				this.renderUnavailable();
			} else {
				this.currentVideoId = null;
			}
		} finally {
			if (token === this.downloadToken) {
				this.isDownloading = false;
				this.downloadCancelled = false;
			}
		}
	}

	cancelDownload(): void {
		if (this.currentVideoId) {
			this.downloadCancelled = true;
			this.onDownloadProgress?.(-1);
			this.audioCacheService?.cancel(this.currentVideoId);
		}
	}

	play(): boolean {
		if (!this.audioElement) return false;
		void this.audioElement.play().catch(() => { /* interrupted by pause — benign */ });
		return true;
	}

	pause(): boolean {
		if (!this.audioElement) return false;
		this.audioElement.pause();
		return true;
	}

	getCurrentTime(): number {
		return this.audioElement?.currentTime ?? 0;
	}

	getDuration(): number {
		return this.audioElement?.duration || 0;
	}

	private activateTrack(videoId: string, autoplayEnabled: boolean): void {
		this.currentVideoId = videoId;
		this.currentAutoplay = autoplayEnabled;
		this.onPlaybackChange(autoplayEnabled ? 'playing' : 'paused');
	}

	seekTo(ratio: number): void {
		if (!this.audioElement) return;
		const duration = this.audioElement.duration || 0;
		if (duration > 0) this.audioElement.currentTime = ratio * duration;
	}

	clear(): void {
		this.currentVideoId = null;
		this.currentAutoplay = false;
		this.silentPauseAudio();
		this.audioElement = null;
		// Notify idle AFTER all teardown is complete so any synchronous
		// re-render triggered by the subscriber sees a fully clean surface.
		this.onPlaybackChange('idle');
	}

	destroy(): void {
		this.silentPauseAudio();
		this.audioElement = null;
	}

	/** Pause the audio element without triggering playback-change notifications.
	 *  The `pause` event fires synchronously from HTMLAudioElement.pause(),
	 *  which would cause re-entrant render cycles through onPlaybackChange. */
	private silentPauseAudio(): void {
		if (!this.audioElement) return;
		this.suppressCallbacks = true;
		try {
			this.audioElement.pause();
		} finally {
			this.suppressCallbacks = false;
		}
	}

	private mountAudio(url: string, autoplay: boolean): void {
		this.silentPauseAudio();
		this.audioElement?.remove();

		const audio = new Audio(url);
		audio.addEventListener('ended', () => {
			if (this.suppressCallbacks) return;
			if (this.repeatMode === 'one') {
				audio.currentTime = 0;
				void audio.play();
				return;
			}
			this.onPlaybackChange('paused');
			void this.onEnded();
		});
		audio.addEventListener('play', () => {
			if (this.suppressCallbacks) return;
			this.onPlaybackChange('playing');
		});
		audio.addEventListener('pause', () => {
			if (this.suppressCallbacks) return;
			this.onPlaybackChange('paused');
		});
		this.audioElement = audio;

		if (autoplay) {
			void audio.play().catch(() => { /* interrupted by pause — benign */ });
		}
	}

	private renderUnavailable(): void {
		this.host.empty();
		const notice = this.host.createDiv({ cls: 'onp-player-unavailable' });
		notice.textContent = 'Playback unavailable — install yt-dlp for audio playback.';
		this.onPlaybackChange('paused');
	}
}
