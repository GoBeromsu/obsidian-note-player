import { LOADING_TITLE, titleState, trackLabel } from '../../domain/track-import';
import { showNotice } from '../notices';
import {
	ItemView,
	Notice,
	setIcon,
	WorkspaceLeaf,
} from 'obsidian';
import type {
	PlaylistSummary,
	PlaylistTrack,
	PlaylistViewHost,
	PlaylistViewState,
} from '../../types/view';
import type { VolumePort } from '../../types/volume';
import { renderVolumeControl } from './volume-control';
import { PlaylistNameModal } from './PlaylistNameModal';
import { YoutubeUrlModal } from './YoutubeUrlModal';
import { Turntable } from './Turntable';
import { TurntableSound } from './turntable-sound';
import { parseYoutubeUrl } from '../../utils/youtube';
import { busyLabel } from '../../domain/ytdlp';
import { PlayerSurface, type StreamPhase } from './PlayerSurface';
import { WaveformProgress } from './WaveformProgress';
import { renderQueue } from './queue-list';
import { openPlaylistMenu } from './view-menus';
import { buildClass, createActionButton, createIconButton, type RunAction } from './view-parts';

export const VIEW_TYPE_NOTE_PLAYER = 'obsidian-note-player-view';
export const VIEW_TYPE_LEGACY = 'youtube-note-playlist-view';
/** Longest onp-count-* animation in styles.css. */
const COUNT_TICK_MS = 480;

interface ViewElements {
	root: HTMLElement;
	toolbarPanel: HTMLElement;
	playerPanel: HTMLElement;
	playerVideo: HTMLElement;
	queuePanel: HTMLElement;
}

export class NotePlayerView extends ItemView {
	private readonly host: PlaylistViewHost;
	private readonly playerSurface: PlayerSurface;
	private readonly playerHostEl: HTMLElement;
	private readonly volume: VolumePort;
	private disposeVolumeControl: (() => void) | null = null;
	private unsubscribeSound: (() => void) | null = null;
	private elements: ViewElements | null = null;
	private unsubscribe: (() => void) | null = null;
	private resizeObserver: ResizeObserver | null = null;
	private resizeFrame: { win: Window; id: number } | null = null;
	private lastRenderedTrackPath: string | null = null;
	private lastCount: { path: string; count: number; changedAt: number } | null = null;
	private progressIntervalId: number | null = null;
	private subtitleEl: HTMLElement | null = null;
	private unavailableShown: string | null = null;
	private subtitleParts = { artist: '', state: '' };
	private wave: { videoId: string; ui: WaveformProgress } | null = null;
	private isRendering = false;
	private readonly sound = new TurntableSound(
		() => this.playerSurface.getVolume(),
		() => this.contentEl.win.matchMedia('(prefers-reduced-motion: reduce)').matches,
	);
	private readonly turntable = new Turntable(this.sound, {
		position: () => {
			const duration = this.playerSurface.getDuration();
			return duration > 0 ? { time: this.playerSurface.getCurrentTime(), duration } : null;
		},
		seekTo: (ratio) => this.playerSurface.seekTo(ratio),
		dropNeedle: () => this.setNeedle(true),
		liftNeedle: () => this.setNeedle(false),
	});

	constructor(
		leaf: WorkspaceLeaf,
		host: PlaylistViewHost,
		playerSurface: PlayerSurface,
		playerHostEl: HTMLElement,
		volume: VolumePort,
	) {
		super(leaf);
		this.host = host;
		this.playerSurface = playerSurface;
		this.playerHostEl = playerHostEl;
		this.volume = volume;
		this.navigation = false;
	}

	getViewType(): string {
		return VIEW_TYPE_NOTE_PLAYER;
	}

	getDisplayText(): string {
		return 'Note Player';
	}

	getIcon(): string {
		return 'play-square';
	}

	onOpen(): Promise<void> {
		const root = this.containerEl.children[1] as HTMLElement;
		root.empty();
		root.addClass('onp-view-root');
		root.tabIndex = -1;
		root.focus({ preventScroll: true });
		for (const gesture of ['pointerdown', 'keydown'] as const) {
			this.registerDomEvent(root, gesture, () => this.sound.unlock(root.win));
		}
		// Rendering empties the panels, which drops focus to body; listen on the document so Cmd+V keeps working.
		const listenPaste = (doc: Document) => this.registerDomEvent(doc, 'paste', (event) => {
			if (root.doc === doc && this.app.workspace.getActiveViewOfType(NotePlayerView) === this) this.importPastedLinks(event);
		});
		listenPaste(root.doc);
		this.register(root.onWindowMigrated((win) => listenPaste(win.document)));
		this.playerSurface.trackLanding(true);
		this.playerSurface.onCached = (videoId) => void this.loadPeaks(videoId);
		this.registerEvent(this.app.workspace.on('css-change', () => this.wave?.ui.refreshColors()));
		this.turntable.onLanded = () => this.playerSurface.needleLanded();
		this.turntable.attachVolume(this.volume);
		this.playerSurface.onNeedleWait = (waiting) => (waiting ? this.sound.startGroove() : this.sound.stopGroove());
		this.playerSurface.onPhaseView = (phase) => this.showPhase(phase);
		this.unsubscribeSound = this.volume.subscribe(() => this.sound.applyVolume());

		const toolbarPanel = root.createDiv({ cls: 'onp-pane-section onp-toolbar-panel' });
		const playerPanel = root.createDiv({ cls: 'onp-pane-section onp-player-panel' });
		const queuePanel = root.createDiv({ cls: 'onp-pane-section onp-queue-panel' });

		this.elements = {
			root,
			toolbarPanel,
			playerPanel,
			playerVideo: this.playerHostEl,
			queuePanel,
		};

		this.observeResize(root, root.win);
		this.register(root.onWindowMigrated((win) => this.observeResize(root, win)));
		this.applyResponsiveClasses(root.clientWidth);

		this.unsubscribe = this.host.subscribe(() => {
			this.render();
		});

		this.render();
		return Promise.resolve();
	}

	/** The root moves into a popout after onOpen, so the observer must be rebuilt on the window that owns it. */
	private observeResize(root: HTMLElement, win: Window): void {
		this.resizeObserver?.disconnect();
		this.cancelResizeFrame();
		this.resizeObserver = new (win as Window & { ResizeObserver: typeof ResizeObserver }).ResizeObserver((entries) => {
			const nextWidth = entries.at(0)?.contentRect.width ?? root.clientWidth;
			this.cancelResizeFrame();
			this.resizeFrame = { win, id: win.requestAnimationFrame(() => this.applyResponsiveClasses(nextWidth)) };
		});
		this.resizeObserver.observe(root);
	}

	private cancelResizeFrame(): void {
		this.resizeFrame?.win.cancelAnimationFrame(this.resizeFrame.id);
		this.resizeFrame = null;
	}

	onClose(): Promise<void> {
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.resizeObserver?.disconnect();
		this.cancelResizeFrame();
		this.resizeObserver = null;
		this.stopProgressInterval();
		this.disposeVolumeControl?.();
		this.disposeVolumeControl = null;
		this.unsubscribeSound?.();
		this.unsubscribeSound = null;
		this.disposeWave();
		this.playerSurface.onCached = null;
		this.playerSurface.onNeedleWait = null;
		this.playerSurface.onPhaseView = null;
		this.playerSurface.trackLanding(false);
		this.turntable.destroy();
		this.sound.close();
		if (this.playerHostEl.parentElement) {
			this.playerHostEl.parentElement.removeChild(this.playerHostEl);
		}
		this.elements = null;
		return Promise.resolve();
	}

	private render(): void {
		if (this.isRendering) return;

		const elements = this.elements;
		if (!elements) return;

		this.isRendering = true;
		try {
			const state = this.host.getState();
			this.renderToolbar(state);
			this.renderPlayer(state);
			renderQueue(elements.queuePanel, state, {
					host: this.host,
					run: this.runAction,
					selectedPlaylist: this.getSelectedPlaylist(state),
				});
		} finally {
			this.isRendering = false;
		}
	}

	private applyResponsiveClasses(width: number): void {
		const root = this.elements?.root;
		if (!root) return;

		root.classList.toggle('is-narrow', width < 860);
		root.classList.toggle('is-compact', width < 560);
	}

	private renderToolbar(state: PlaylistViewState): void {
		const elements = this.elements;
		if (!elements) return;

		elements.toolbarPanel.empty();

		const bar = elements.toolbarPanel.createDiv({ cls: 'onp-toolbar-bar' });
		const controls = bar.createDiv({ cls: 'onp-toolbar-controls' });
		const select = controls.createEl('select', { cls: 'dropdown onp-toolbar-select' });
		select.createEl('option', { value: '', text: 'Select a playlist' });
		for (const playlist of state.playlists) {
			select.createEl('option', { value: playlist.path, text: playlist.title });
		}
		select.value = state.selectedPlaylistPath ?? '';
		select.addEventListener('change', () => {
			const value = select.value;
			void this.runAction(
				value ? `Loaded playlist ${this.lookupPlaylistTitle(state.playlists, value)}.` : 'Playlist cleared.',
				() => this.host.selectPlaylist(value || null),
			);
		});

		const playlist = this.getSelectedPlaylist(state);
		if (playlist) {
			const unit = state.queue.length === 1 ? 'track' : 'tracks';
			const now = performance.now();
			if (this.lastCount?.path !== playlist.path || this.lastCount.count !== state.queue.length) {
				this.lastCount = { path: playlist.path, count: state.queue.length, changedAt: this.lastCount?.path === playlist.path ? now : -Infinity };
			}
			const elapsed = now - this.lastCount.changedAt;
			const count = controls.createSpan({ cls: 'onp-toolbar-count', attr: { title: `${state.queue.length} ${unit}` } });
			// A count change is followed by more renders (metadata re-parse) that rebuild the span; resume the tick where it was.
			if (elapsed < COUNT_TICK_MS) {
				count.addClass('is-tick');
				for (const animation of count.getAnimations()) animation.currentTime = elapsed;
			}
			count.createSpan({ text: String(state.queue.length) });
			count.createSpan({ cls: 'onp-toolbar-count-unit', text: ` ${unit}` });
			controls.appendChild(createIconButton('Playlist actions', 'more-vertical', (event) => {
				openPlaylistMenu(event, this.host, playlist, this.runAction, state);
			}));
		}

		if (this.host.addTrackFromUrl) {
			controls.appendChild(createIconButton('Add YouTube URL', 'link', () => {
				this.openYoutubeUrlModal();
			}));
		}

		controls.appendChild(createIconButton('Create playlist', 'plus', () => {
			this.openCreatePlaylistModal();
		}));
	}

	private renderPlayer(state: PlaylistViewState): void {
		const elements = this.elements;
		if (!elements) return;

		// Detach player host before emptying — it holds the live YouTube iframe.
		if (this.playerHostEl.parentElement) {
			this.playerHostEl.parentElement.removeChild(this.playerHostEl);
		}

		this.disposeVolumeControl?.();
		this.disposeVolumeControl = null;
		elements.playerPanel.empty();

		const current = state.currentTrack;
		if (!current) {
			// Keep the slot (and its height) so the track list never jumps when playback starts.
			elements.playerPanel.removeClass('onp-hidden');
			const idleRail = elements.playerPanel.createDiv({ cls: 'onp-now-playing-shell' });
			idleRail.prepend(this.turntable.el);
			const idleMeta = idleRail.createDiv({ cls: 'onp-now-playing-summary' })
				.createDiv({ cls: 'onp-track-card onp-track-card--compact onp-track-card--no-thumb' })
				.createDiv({ cls: 'onp-track-meta' });
			idleMeta.createDiv({ cls: 'onp-now-playing-kicker', text: 'Now playing' });
			idleMeta.createDiv({ cls: 'onp-track-title', text: 'Nothing playing' });
			idleMeta.createDiv({ cls: 'onp-track-subtitle', text: 'Pick a track to drop the needle' });
			this.lastRenderedTrackPath = null;
			this.disposeWave();
			this.stopProgressInterval();
			this.turntable.update(null, state.playbackState, state.turntableSounds, state.turntableStyle);
			// Only clear the surface when it actually has a track loaded.
			// Calling clear() unconditionally triggers onPlaybackChange('idle') -> notifyChange -> render -> infinite loop.
			if (state.playbackState !== 'idle') {
				this.playerSurface.clear();
			}
			return;
		}

		const playbackState = state.playbackState;

		elements.playerPanel.removeClass('onp-hidden');
		const playerRail = elements.playerPanel.createDiv({ cls: 'onp-now-playing-shell' });
		playerRail.prepend(this.turntable.el);
		this.turntable.update(current, playbackState, state.turntableSounds, state.turntableStyle);
		const summary = playerRail.createDiv({ cls: 'onp-now-playing-summary' });
		const trackCard = summary.createDiv({ cls: 'onp-track-card onp-track-card--compact onp-track-card--no-thumb onp-player-track-card' });
		const meta = trackCard.createDiv({ cls: 'onp-track-meta' });
		meta.createDiv({ cls: 'onp-now-playing-kicker', text: 'Now playing' });
		const titleStatus = titleState(current, state.loadingTitles.has(current.videoId));
		const loading = titleStatus === 'loading';
		// The same track last drawn without a title that now has one was just healed; fade the new text in.
		const healed = titleStatus === 'ready' && this.unavailableShown === current.videoId;
		this.unavailableShown = titleStatus === 'ready' ? null : current.videoId;
		meta.createDiv({
			cls: buildClass('onp-track-title', { 'is-unavailable': titleStatus === 'unavailable', 'is-resolving': loading, 'is-healed': healed }),
			text: loading ? LOADING_TITLE : trackLabel(current),
		});
		this.subtitleEl = meta.createDiv({ cls: buildClass('onp-track-subtitle', { 'is-healed': healed }) });
		const activate = () => {
			const phase = this.playerSurface.phase;
			if (phase === 'failed') this.playerSurface.retry();
			else if (phase === 'missing') this.playerSurface.onNeedSetup?.();
		};
		this.subtitleEl.addEventListener('click', activate);
		this.subtitleParts = { artist: current.artist ?? '', state: state.autoplayEnabled ? 'Autoplay on' : 'Autoplay off' };
		this.showPhase(this.playerSurface.phase);

		const controls = summary.createDiv({ cls: 'onp-control-row onp-player-controls' });
		const transport = controls.createDiv({ cls: 'onp-controls-group' });
		transport.appendChild(createActionButton('Previous', 'skip-back', () => {
			void this.runAction('', () => this.host.playPrevious(), false);
		}, { iconOnly: true }));
		transport.appendChild(createActionButton(
			playbackState === 'playing' ? 'Pause current track' : 'Play current track',
			playbackState === 'playing' ? 'pause' : 'play',
			() => {
				void this.toggleCurrentPlayback(current);
			},
			{ cta: true, iconOnly: true },
		));
		transport.appendChild(createActionButton('Next', 'skip-forward', () => {
			void this.runAction('', () => this.host.playNext(), false);
		}, { iconOnly: true }));
		const extras = controls.createDiv({ cls: 'onp-controls-group onp-controls-group--end' });
		this.disposeVolumeControl = renderVolumeControl(extras, this.volume);
		extras.appendChild(createActionButton('Open note', 'file-text', () => {
			void this.runAction('', () => this.host.openNote(current.path), false);
		}, { iconOnly: true }));
		extras.appendChild(createActionButton(
			state.autoplayEnabled ? 'Disable autoplay' : 'Enable autoplay',
			state.autoplayEnabled ? 'radio' : 'circle',
			() => {
				void this.toggleAutoplay(state.autoplayEnabled);
			},
			{ iconOnly: true, active: state.autoplayEnabled },
		));
		if (this.host.toggleRepeatMode) {
			extras.appendChild(createActionButton(
				state.repeatMode === 'one' ? 'Disable repeat' : 'Repeat one',
				'repeat-1',
				() => {
					void this.runAction(
						state.repeatMode === 'one' ? 'Repeat off.' : 'Repeat on.',
						() => this.host.toggleRepeatMode?.() ?? Promise.resolve(),
					);
				},
				{ iconOnly: true, active: state.repeatMode === 'one' },
			));
		}

		this.mountWave(summary, current.videoId);

		this.syncProgressBar();
		if (playbackState === 'playing') {
			this.startProgressInterval();
		} else {
			this.stopProgressInterval();
		}

		const videoShell = playerRail.createDiv({
			cls: 'onp-player-video-shell',
		});
		videoShell.appendChild(this.playerHostEl);
		void this.playerSurface.render(current, state.startPlayback);

		this.lastRenderedTrackPath = current.path;
	}

	/** Updates the subtitle in place so the connecting and failed states appear with no re-render. */
	private showPhase(phase: StreamPhase): void {
		const busy = phase === 'connecting' || phase === 'downloading' || phase === 'converting';
		this.turntable.el.toggleClass('is-connecting', busy);
		this.turntable.el.toggleClass('is-failed', phase === 'failed' || phase === 'missing');
		const el = this.subtitleEl;
		if (!el) return;
		el.toggleClass('is-connecting', busy);
		const needsAction = phase === 'failed' || phase === 'missing';
		el.toggleClass('is-failed', needsAction);
		if (needsAction) {
			el.empty();
			const cue = el.createEl('button', { cls: 'clickable-icon onp-deck-cue' });
			setIcon(cue.createSpan(), phase === 'missing' ? 'wrench' : 'cloud-off');
			cue.createSpan({ text: phase === 'missing' ? 'yt-dlp not found · click for setup' : "Couldn't load · click to retry" });
		} else if (busy) {
			el.setText(busyLabel(phase, this.playerSurface.downloadPercent));
		} else {
			const { artist, state } = this.subtitleParts;
			el.empty();
			if (artist) {
				el.createSpan({ cls: 'onp-subtitle-artist', text: artist, attr: { title: artist } });
				el.createSpan({ cls: 'onp-subtitle-state', text: state });
			} else {
				el.createSpan({ cls: 'onp-subtitle-state', text: state });
			}
		}
	}

	private getSelectedPlaylist(state: PlaylistViewState): PlaylistSummary | undefined {
		return state.playlists.find((playlist) => playlist.path === state.selectedPlaylistPath);
	}

	private lookupPlaylistTitle(playlists: PlaylistSummary[], path: string): string {
		return playlists.find((playlist) => playlist.path === path)?.title ?? 'playlist';
	}

	private startProgressInterval(): void {
		this.stopProgressInterval();
		this.progressIntervalId = window.setInterval(() => {
			this.syncProgressBar();
		}, 1000);
	}

	private stopProgressInterval(): void {
		if (this.progressIntervalId !== null) {
			window.clearInterval(this.progressIntervalId);
			this.progressIntervalId = null;
		}
	}

	private syncProgressBar(): void {
		const duration = this.playerSurface.getDuration();
		this.turntable.setProgress(duration > 0 ? Math.min(this.playerSurface.getCurrentTime() / duration, 1) : 0);
		this.wave?.ui.sync();
	}

	private mountWave(parent: HTMLElement, videoId: string): void {
		this.disposeWave();
		const ui = new WaveformProgress(parent, {
			getTime: () => this.playerSurface.getCurrentTime(),
			getDuration: () => this.playerSurface.getDuration(),
			isPlaying: () => this.host.getState().playbackState === 'playing',
			seekTo: (ratio) => this.playerSurface.seekTo(ratio),
			reducedMotion: () => this.contentEl.win.matchMedia('(prefers-reduced-motion: reduce)').matches,
		});
		this.wave = { videoId, ui };
		const known = this.host.getPeaksStore?.()?.peek(videoId);
		if (known) ui.setPeaks(known, false);
		else void this.loadPeaks(videoId);
	}

	private async loadPeaks(videoId: string): Promise<void> {
		const peaks = await this.host.getPeaksStore?.()?.ensure(videoId);
		if (peaks && this.wave?.videoId === videoId) this.wave.ui.setPeaks(peaks, true);
	}

	private disposeWave(): void {
		this.wave?.ui.destroy();
		this.wave = null;
	}

	private setNeedle(down: boolean): void {
		const current = this.host.getState().currentTrack;
		if (!current || (this.host.getState().playbackState === 'playing') === down) return;
		void this.toggleCurrentPlayback(current);
	}

	private async toggleCurrentPlayback(current: PlaylistTrack): Promise<void> {
		const playbackState = this.host.getState().playbackState;
		if (playbackState === 'playing') {
			this.playerSurface.pause();
			return;
		}
		if (this.playerSurface.phase === 'failed') {
			this.playerSurface.retry();
			return;
		}

		const handled = this.playerSurface.play();
		if (!handled) {
			await this.host.playTrack(current.path);
		}
	}

	private async toggleAutoplay(currentValue: boolean): Promise<void> {
		if (this.host.setAutoplayEnabled) {
			await this.runAction(
				currentValue ? 'Autoplay off.' : 'Autoplay on.',
				() => this.host.setAutoplayEnabled?.(!currentValue) ?? Promise.resolve(),
			);
			return;
		}

		if (this.host.toggleAutoplay) {
			await this.runAction(
				currentValue ? 'Autoplay off.' : 'Autoplay on.',
				() => this.host.toggleAutoplay?.() ?? Promise.resolve(),
			);
		}
	}

	private importPastedLinks(event: ClipboardEvent): void {
		const target = event.target as Node | null;
		if (target?.instanceOf(HTMLElement) && target.closest('input, textarea, select, [contenteditable="true"]')) return;
		const text = event.clipboardData?.getData('text') ?? '';
		const urls = text.split(/\s+/).filter((part) => /youtu/i.test(part) && parseYoutubeUrl(part));
		if (urls.length === 0) return;
		event.preventDefault();
		for (const url of urls) this.addFromUrl(url);
	}

	private addFromUrl(input: string): void {
		void this.runAction('', () => this.host.addTrackFromUrl?.(input) ?? Promise.resolve(), false);
	}

	private openYoutubeUrlModal(): void {
		new YoutubeUrlModal(this.app, (input) => this.addFromUrl(input)).open();
	}

	private openCreatePlaylistModal(): void {
		new PlaylistNameModal(this.app, (name) => {
			void this.runAction('', () => this.host.createPlaylist(name), false);
		}).open();
	}

	private readonly runAction: RunAction = async (successMessage, action, showSuccess = true) => {
		try {
			await action();
			if (showSuccess && successMessage) {
				showNotice('action_succeeded', { message: successMessage });
			}
		} catch (error) {
			console.error('Note Player action failed', error);
			new Notice("That didn't work. Try again.");
		} finally {
			this.render();
		}
	};
}
