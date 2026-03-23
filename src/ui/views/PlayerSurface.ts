import type { AudioCachePort } from '../../types/view';
import type { PlaylistTrack } from '../../types/view';
import type { PlaybackState } from '../../types/playback';

export type { PlaybackState };

interface YouTubeApiNamespace {
	Player: new (
		element: HTMLElement,
		config: {
			videoId: string;
			playerVars: Record<string, string | number>;
			events: {
				onReady?: () => void;
				onError?: () => void;
				onStateChange: (event: { data: number }) => void;
			};
		},
	) => YouTubePlayerInstance;
	PlayerState: {
		ENDED: number;
		PAUSED: number;
		PLAYING: number;
	};
}

interface YouTubePlayerInstance {
	destroy(): void;
	getCurrentTime(): number;
	getDuration(): number;
	loadVideoById(videoId: string): void;
	pauseVideo(): void;
	playVideo(): void;
	seekTo(seconds: number, allowSeekAhead: boolean): void;
	stopVideo(): void;
}

declare global {
	interface Window {
		YT?: YouTubeApiNamespace;
		onYouTubeIframeAPIReady?: () => void;
	}
}

export function formatTime(seconds: number): string {
	const s = Math.floor(seconds);
	const mins = Math.floor(s / 60);
	const secs = s % 60;
	return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

let youtubeApiPromise: Promise<YouTubeApiNamespace> | null = null;

function loadYouTubeApi(): Promise<YouTubeApiNamespace> {
	if (window.YT?.Player) {
		return Promise.resolve(window.YT);
	}

	if (youtubeApiPromise) {
		return youtubeApiPromise;
	}

	youtubeApiPromise = new Promise<YouTubeApiNamespace>((resolve, reject) => {
		const existing = document.querySelector('script[data-onp-youtube-api="true"]');
		const waitForReady = (remainingAttempts: number) => {
			if (window.YT?.Player) {
				resolve(window.YT);
				return;
			}

			if (remainingAttempts <= 0) {
				reject(new Error('YouTube player API did not initialize.'));
				return;
			}

			window.setTimeout(() => waitForReady(remainingAttempts - 1), 250);
		};

		window.onYouTubeIframeAPIReady = () => waitForReady(20);

		if (existing) {
			waitForReady(20);
			return;
		}

		const script = document.createElement('script');
		script.src = 'https://www.youtube.com/iframe_api';
		script.async = true;
		script.dataset.onpYoutubeApi = 'true';
		script.onerror = () => reject(new Error('Failed to load the YouTube player API.'));
		document.head.appendChild(script);
	});

	return youtubeApiPromise;
}

export class PlayerSurface {
	private currentVideoId: string | null = null;
	private currentAutoplay = false;
	private host: HTMLElement;
	private player: YouTubePlayerInstance | null = null;
	private playerRoot: HTMLElement | null = null;
	private audioElement: HTMLAudioElement | null = null;
	private audioCacheService: AudioCachePort | null = null;
	private hasReceivedPlayingState = false;
	private audioFallbackAttempted = false;

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

	async render(track: PlaylistTrack, autoplayEnabled: boolean): Promise<void> {
		if (this.currentVideoId === track.videoId && this.currentAutoplay === autoplayEnabled) {
			if (this.player || this.audioElement) {
				return;
			}
		}

		// Always create a fresh player — loadVideoById breaks after DOM re-attachment
		this.player?.destroy();
		this.player = null;
		this.audioElement?.pause();
		this.audioElement = null;
		this.playerRoot?.remove();
		this.playerRoot = null;

		try {
			const api = await loadYouTubeApi();
			this.mountPlayerRoot();

			this.player = new api.Player(this.playerRoot!, {
				videoId: track.videoId,
				playerVars: {
					autoplay: autoplayEnabled ? 1 : 0,
					modestbranding: 1,
					playsinline: 1,
					rel: 0,
					origin: window.location.origin,
				},
				events: {
					onReady: () => {
						this.hasReceivedPlayingState = false;
						this.audioFallbackAttempted = false;
						this.activateTrack(track.videoId, autoplayEnabled);
						if (autoplayEnabled) {
							window.setTimeout(() => {
								if (this.currentVideoId === track.videoId && !this.hasReceivedPlayingState && !this.audioFallbackAttempted) {
									try {
										const currentTime = this.player?.getCurrentTime?.() ?? 0;
										if (currentTime > 1) {
											this.hasReceivedPlayingState = true;
											return;
										}
									} catch { /* player may be in bad state, proceed with fallback */ }
									this.audioFallbackAttempted = true;
									void this.renderAudioFallback(track, autoplayEnabled);
								}
							}, 5000);
						}
					},
					onError: () => {
						if (!this.audioFallbackAttempted) {
							this.audioFallbackAttempted = true;
							void this.renderAudioFallback(track, autoplayEnabled);
						}
					},
					onStateChange: (event: { data: number }) => {
						if (event.data === api.PlayerState.PLAYING) {
							this.hasReceivedPlayingState = true;
							this.onPlaybackChange('playing');
							return;
						}

						if (event.data === api.PlayerState.PAUSED || event.data === api.PlayerState.ENDED) {
							this.onPlaybackChange('paused');
						}

						if (event.data === api.PlayerState.ENDED) {
							void this.onEnded();
						}
					},
				},
			});
		} catch {
			void this.renderAudioFallback(track, autoplayEnabled);
		}
	}

	async play(): Promise<boolean> {
		if (this.audioElement) {
			void this.audioElement.play();
			return true;
		}
		if (this.player) {
			try { this.player.playVideo(); } catch { /* player not ready */ }
			return true;
		}

		return false;
	}

	async pause(): Promise<boolean> {
		if (this.audioElement) {
			this.audioElement.pause();
			return true;
		}
		if (this.player) {
			try { this.player.pauseVideo(); } catch { /* player not ready */ }
			return true;
		}

		return false;
	}

	getCurrentTime(): number {
		if (this.audioElement) return this.audioElement.currentTime;
		if (!this.player) return 0;
		try { return this.player.getCurrentTime(); } catch { return 0; }
	}

	getDuration(): number {
		if (this.audioElement) return this.audioElement.duration || 0;
		if (!this.player) return 0;
		try { return this.player.getDuration(); } catch { return 0; }
	}

	private activateTrack(videoId: string, autoplayEnabled: boolean): void {
		this.currentVideoId = videoId;
		this.currentAutoplay = autoplayEnabled;
		this.onPlaybackChange(autoplayEnabled ? 'playing' : 'paused');
	}

	seekTo(ratio: number): void {
		if (this.audioElement) {
			const duration = this.audioElement.duration || 0;
			if (duration > 0) this.audioElement.currentTime = ratio * duration;
			return;
		}
		const duration = this.getDuration();
		if (this.player && duration > 0) {
			this.player.seekTo(ratio * duration, true);
		}
	}

	clear(): void {
		this.currentVideoId = null;
		this.currentAutoplay = false;
		this.onPlaybackChange('idle');
		this.player?.destroy();
		this.player = null;
		this.audioElement?.pause();
		this.audioElement = null;
		this.playerRoot?.remove();
		this.playerRoot = null;
	}

	destroy(): void {
		this.player?.destroy();
		this.player = null;
		this.audioElement?.pause();
		this.audioElement = null;
		this.playerRoot?.remove();
		this.playerRoot = null;
	}

	private async renderAudioFallback(track: PlaylistTrack, autoplayEnabled: boolean): Promise<void> {
		this.host.empty();
		this.player?.destroy();
		this.player = null;
		this.playerRoot = null;

		if (!this.audioCacheService) {
			this.renderUnavailable();
			return;
		}

		const videoId = track.videoId;

		if (this.audioCacheService.hasCached(videoId)) {
			this.mountAudio(this.audioCacheService.getFileUrl(videoId), autoplayEnabled);
			this.activateTrack(videoId, autoplayEnabled);
			return;
		}

		this.onPlaybackChange('paused');
		this.currentVideoId = videoId;
		this.currentAutoplay = autoplayEnabled;

		try {
			await this.audioCacheService.download(videoId, () => {});
			this.mountAudio(this.audioCacheService.getFileUrl(videoId), autoplayEnabled);
			this.activateTrack(videoId, autoplayEnabled);
		} catch {
			this.renderUnavailable();
		}
	}

	private mountAudio(url: string, autoplay: boolean): void {
		this.audioElement?.pause();
		this.audioElement?.remove();

		const audio = new Audio(url);
		audio.addEventListener('ended', () => {
			this.onPlaybackChange('paused');
			void this.onEnded();
		});
		audio.addEventListener('play', () => this.onPlaybackChange('playing'));
		audio.addEventListener('pause', () => this.onPlaybackChange('paused'));
		this.audioElement = audio;

		if (autoplay) {
			void audio.play();
		}
	}

	private mountPlayerRoot(): void {
		if (this.playerRoot) return;
		this.host.empty();
		this.playerRoot = this.host.createDiv({ cls: 'onp-iframe-api-host' });
	}

	private renderUnavailable(): void {
		this.host.empty();
		const notice = this.host.createDiv({ cls: 'onp-player-unavailable' });
		notice.textContent = 'Playback unavailable — install yt-dlp for audio fallback.';
		this.onPlaybackChange('paused');
	}
}
