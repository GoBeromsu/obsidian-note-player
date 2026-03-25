import {
	ItemView,
	Menu,
	Notice,
	WorkspaceLeaf,
	setIcon,
} from 'obsidian';
import type {
	PlaylistSummary,
	PlaylistTrack,
	PlaylistViewHost,
	PlaylistViewState,
} from '../../types/view';
import { PlaylistNameModal } from './PlaylistNameModal';
import { PlayerSurface, formatTime } from './PlayerSurface';

export const VIEW_TYPE_NOTE_PLAYER = 'obsidian-note-player-view';
export const VIEW_TYPE_LEGACY = 'youtube-note-playlist-view';

interface ViewElements {
	root: HTMLElement;
	toolbarPanel: HTMLElement;
	heroPanel: HTMLElement;
	playerPanel: HTMLElement;
	playerVideo: HTMLElement;
	progressBar: HTMLElement | null;
	progressFill: HTMLElement | null;
	progressTime: HTMLElement | null;
	queuePanel: HTMLElement;
}

export class NotePlayerView extends ItemView {
	private readonly host: PlaylistViewHost;
	private readonly playerSurface: PlayerSurface;
	private readonly playerHostEl: HTMLElement;
	private elements: ViewElements | null = null;
	private unsubscribe: (() => void) | null = null;
	private resizeObserver: ResizeObserver | null = null;
	private dragFromIndex: number | null = null;
	private actionInFlight = false;
	private lastRenderedTrackPath: string | null = null;
	private progressIntervalId: number | null = null;
	private isRendering = false;

	constructor(
		leaf: WorkspaceLeaf,
		host: PlaylistViewHost,
		playerSurface: PlayerSurface,
		playerHostEl: HTMLElement,
	) {
		super(leaf);
		this.host = host;
		this.playerSurface = playerSurface;
		this.playerHostEl = playerHostEl;
		this.navigation = false;
	}

	getViewType(): string {
		return VIEW_TYPE_NOTE_PLAYER;
	}

	getDisplayText(): string {
		return 'Note player';
	}

	getIcon(): string {
		return 'play-square';
	}

	onOpen(): Promise<void> {
		const root = this.containerEl.children[1] as HTMLElement;
		root.empty();
		root.addClass('onp-view-root');

		const toolbarPanel = root.createDiv({ cls: 'onp-pane-section onp-toolbar-panel' });
		const heroPanel = root.createDiv({ cls: 'onp-pane-section onp-hero-panel' });
		const playerPanel = root.createDiv({ cls: 'onp-pane-section onp-player-panel' });
		const queuePanel = root.createDiv({ cls: 'onp-pane-section onp-queue-panel' });

		this.elements = {
			root,
			toolbarPanel,
			heroPanel,
			playerPanel,
			playerVideo: this.playerHostEl,
			progressBar: null,
			progressFill: null,
			progressTime: null,
			queuePanel,
		};

		this.resizeObserver = new ResizeObserver((entries) => {
			const nextWidth = entries.at(0)?.contentRect.width ?? root.clientWidth;
			this.applyResponsiveClasses(nextWidth);
		});
		this.resizeObserver.observe(root);
		this.applyResponsiveClasses(root.clientWidth);

		this.unsubscribe = this.host.subscribe(() => {
			this.render();
		});

		this.render();
		return Promise.resolve();
	}

	onClose(): Promise<void> {
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
		this.stopProgressInterval();
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
			this.renderHero(state);
			this.renderPlayer(state);
			this.renderQueue(state);
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
		const copy = bar.createDiv({ cls: 'onp-toolbar-copy' });
		copy.createDiv({ cls: 'onp-toolbar-label', text: 'Note Player' });

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
				value ? `Loaded ${this.lookupPlaylistTitle(state.playlists, value)}` : 'Cleared playlist',
				() => this.host.selectPlaylist(value || null),
			);
		});

		controls.appendChild(this.createIconButton('Create playlist', 'plus', () => {
			this.openCreatePlaylistModal();
		}));

		if (this.host.selectActivePlaylist) {
			controls.appendChild(this.createIconButton('Load active playlist note', 'crosshair', () => {
				void this.runAction('Loaded active playlist', () => this.host.selectActivePlaylist?.() ?? Promise.resolve());
			}));
		}

		controls.appendChild(this.createIconButton('Refresh library', 'refresh-cw', () => {
			void this.runAction('Refreshed library', () => this.host.refresh());
		}));
	}

	private renderHero(state: PlaylistViewState): void {
		const elements = this.elements;
		if (!elements) return;

		elements.heroPanel.empty();

		const selectedPlaylist = this.getSelectedPlaylist(state);
		if (state.isLoading) {
			this.renderEmptyState(elements.heroPanel, 'Loading playlist', 'Scanning playlists and music notes from the vault.');
			return;
		}

		if (state.errorMessage) {
			this.renderEmptyState(elements.heroPanel, 'Playlist error', state.errorMessage);
			return;
		}

		if (!selectedPlaylist) {
			this.renderEmptyState(elements.heroPanel, 'Choose a playlist', 'Select a playlist note to see its cover, metadata, and ordered tracks.');
			return;
		}

		const coverImage = selectedPlaylist.coverImage ?? state.queue[0]?.thumbnailUrl ?? state.currentTrack?.thumbnailUrl ?? '';
		const hero = elements.heroPanel.createDiv({ cls: 'onp-playlist-hero' });
		const cover = hero.createDiv({ cls: 'onp-hero-cover' });
		if (coverImage) {
			cover.setCssProps({ '--onp-cover-image': `url("${coverImage}")` });
		} else {
			const icon = cover.createDiv({ cls: 'onp-empty-icon' });
			setIcon(icon, 'music-4');
		}

		const copy = hero.createDiv({ cls: 'onp-hero-copy' });
		copy.createDiv({ cls: 'onp-hero-kicker', text: 'Playlist' });
		copy.createEl('h2', { cls: 'onp-hero-title', text: selectedPlaylist.title });
		copy.createDiv({
			cls: 'onp-hero-meta',
			text: `${selectedPlaylist.trackCount} tracks • ${state.library.length} music notes`,
		});

		if (selectedPlaylist.description) {
			copy.createDiv({ cls: 'onp-hero-description', text: selectedPlaylist.description });
		}

		const actions = copy.createDiv({ cls: 'onp-hero-actions' });
		if (!state.currentTrack && state.queue.length > 0) {
			actions.appendChild(this.createActionButton('Play all', 'play', () => {
				const firstTrack = state.queue[0];
				if (!firstTrack) return;
				void this.runAction(`Playing ${firstTrack.title}`, () => this.host.playTrack(firstTrack.path));
			}, { cta: true, iconOnly: true }));
		}

		actions.appendChild(this.createMenuButton('Playlist actions', 'more-vertical', (event) => {
			this.openPlaylistMenu(event, selectedPlaylist);
		}));
	}

	private renderPlayer(state: PlaylistViewState): void {
		const elements = this.elements;
		if (!elements) return;

		// Detach player host before emptying — it holds the live YouTube iframe.
		if (this.playerHostEl.parentElement) {
			this.playerHostEl.parentElement.removeChild(this.playerHostEl);
		}

		elements.playerPanel.empty();

		const current = state.currentTrack;
		if (!current) {
			elements.playerPanel.addClass('onp-hidden');
			this.lastRenderedTrackPath = null;
			elements.progressBar = null;
			elements.progressFill = null;
			elements.progressTime = null;
			this.stopProgressInterval();
			// Only clear the surface when it actually has a track loaded.
			// Calling clear() unconditionally triggers onPlaybackChange('idle') -> notifyChange -> render -> infinite loop.
			if (state.playbackState !== 'idle') {
				this.playerSurface.clear();
			}
			return;
		}

		// Show install instructions when yt-dlp is not available
		const audioCacheService = this.host.getAudioCacheService?.();
		if (audioCacheService && !audioCacheService.isAvailable()) {
			elements.playerPanel.removeClass('onp-hidden');
			const installNotice = elements.playerPanel.createDiv({ cls: 'onp-download-overlay' });
			installNotice.createDiv({ cls: 'onp-download-text', text: 'Install yt-dlp to play music' });
			installNotice.createDiv({ cls: 'onp-download-text onp-install-hint', text: 'brew install yt-dlp' });
			return;
		}

		const playbackState = state.playbackState;

		elements.playerPanel.removeClass('onp-hidden');
		const playerRail = elements.playerPanel.createDiv({ cls: 'onp-now-playing-shell' });
		const summary = playerRail.createDiv({ cls: 'onp-now-playing-summary' });
		const trackCard = summary.createDiv({ cls: 'onp-track-card onp-track-card--compact onp-player-track-card' });
		const thumb = trackCard.createDiv({ cls: 'onp-track-thumb' });
		thumb.setCssProps({ '--onp-thumb-image': `url("${current.thumbnailUrl}")` });

		const meta = trackCard.createDiv({ cls: 'onp-track-meta' });
		meta.createDiv({ cls: 'onp-now-playing-kicker', text: 'Now playing' });
		meta.createDiv({ cls: 'onp-track-title', text: current.title });
		meta.createDiv({
			cls: 'onp-track-subtitle',
			text: `${current.artist || 'Unknown artist'} • ${state.autoplayEnabled ? 'Autoplay on' : 'Autoplay off'}`,
		});

		const controls = summary.createDiv({ cls: 'onp-control-row onp-player-controls' });
		controls.appendChild(this.createActionButton('Previous', 'skip-back', () => {
			void this.runAction('Moved to previous track', () => this.host.playPrevious());
		}, { iconOnly: true }));
		controls.appendChild(this.createActionButton(
			playbackState === 'playing' ? 'Pause current track' : 'Play current track',
			playbackState === 'playing' ? 'pause' : 'play',
			() => {
				void this.toggleCurrentPlayback(current);
			},
			{ cta: true, iconOnly: true },
		));
		controls.appendChild(this.createActionButton('Next', 'skip-forward', () => {
			void this.runAction('Moved to next track', () => this.host.playNext());
		}, { iconOnly: true }));
		controls.createDiv({ cls: 'onp-controls-spacer' });
		controls.appendChild(this.createActionButton('Open note', 'file-text', () => {
			void this.runAction('', () => this.host.openNote(current.path), false);
		}, { iconOnly: true }));
		controls.appendChild(this.createActionButton(
			state.autoplayEnabled ? 'Disable autoplay' : 'Enable autoplay',
			state.autoplayEnabled ? 'radio' : 'circle',
			() => {
				void this.toggleAutoplay(state.autoplayEnabled);
			},
			{ iconOnly: true, active: state.autoplayEnabled },
		));
		if (this.host.toggleRepeatMode) {
			controls.appendChild(this.createActionButton(
				state.repeatMode === 'one' ? 'Disable repeat' : 'Repeat one',
				'repeat-1',
				() => {
					void this.runAction(
						state.repeatMode === 'one' ? 'Repeat off' : 'Repeat one',
						() => this.host.toggleRepeatMode?.() ?? Promise.resolve(),
					);
				},
				{ iconOnly: true, active: state.repeatMode === 'one' },
			));
		}

		const progressShell = summary.createDiv({ cls: 'onp-progress-shell' });
		const progressBar = progressShell.createDiv({ cls: 'onp-progress-bar' });
		const progressFill = progressBar.createDiv({ cls: 'onp-progress-fill' });
		const progressTime = progressShell.createDiv({ cls: 'onp-progress-time' });
		elements.progressBar = progressBar;
		elements.progressFill = progressFill;
		elements.progressTime = progressTime;

		progressBar.addEventListener('click', (event) => {
			const rect = progressBar.getBoundingClientRect();
			const ratio = (event.clientX - rect.left) / rect.width;
			this.playerSurface.seekTo(ratio);
		});

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
		void this.playerSurface.render(current, state.autoplayEnabled);

		this.lastRenderedTrackPath = current.path;
	}

	private renderQueue(state: PlaylistViewState): void {
		const elements = this.elements;
		if (!elements) return;

		elements.queuePanel.empty();

		const header = elements.queuePanel.createDiv({ cls: 'onp-section-header' });
		header.createDiv({ cls: 'onp-section-title', text: 'Tracks' });
		const selectedPlaylist = this.getSelectedPlaylist(state);
		header.createDiv({
			cls: 'onp-section-meta',
			text: selectedPlaylist ? `${state.queue.length} tracks` : 'Select a playlist first',
		});

		if (state.isLoading) {
			this.renderEmptyState(elements.queuePanel, 'Loading playlist', 'Reading playlist note references.');
			return;
		}

		if (!selectedPlaylist) {
			this.renderEmptyState(elements.queuePanel, 'Choose a playlist', 'The playlist rows appear here once you select a playlist.');
			return;
		}

		if (state.queue.length === 0) {
			this.renderEmptyState(elements.queuePanel, 'Playlist is empty', 'Use Music.base or the active-note action to add music notes to this playlist.');
			return;
		}

		const list = elements.queuePanel.createDiv({ cls: 'onp-list onp-queue-list' });
		state.queue.forEach((track, index) => {
			const row = list.createDiv({
				cls: this.buildRowClass('onp-track-row', {
					'is-current': state.currentTrack?.path === track.path,
					'is-drag-source': this.dragFromIndex === index,
				}),
			});

			const grip = row.createDiv({ cls: 'onp-row-grip' });
			grip.setAttribute('draggable', 'true');
			grip.setAttribute('aria-label', 'Drag to reorder');
			grip.setAttribute('title', 'Drag to reorder');
			setIcon(grip.createDiv({ cls: 'onp-row-grip-icon' }), 'grip-vertical');
			grip.createSpan({ cls: 'onp-row-order', text: String(index + 1).padStart(2, '0') });

			grip.addEventListener('dragstart', (event) => {
				this.dragFromIndex = index;
				row.addClass('is-drag-source');
				event.dataTransfer!.effectAllowed = 'move';
				event.dataTransfer?.setData('text/plain', String(index));
				event.dataTransfer?.setDragImage(row, 28, 28);
			});
			grip.addEventListener('dragend', () => {
				this.dragFromIndex = null;
				row.removeClass('is-drag-source');
				row.removeClass('is-drop-target');
			});
			row.addEventListener('dragenter', (event) => {
				event.preventDefault();
				row.addClass('is-drop-target');
			});
			row.addEventListener('dragover', (event) => {
				event.preventDefault();
				if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
				row.addClass('is-drop-target');
			});
			row.addEventListener('dragleave', () => {
				row.removeClass('is-drop-target');
			});
			row.addEventListener('drop', (event) => {
				event.preventDefault();
				row.removeClass('is-drop-target');
				const rawIndex = event.dataTransfer?.getData('text/plain');
				const fromIndex = rawIndex ? Number(rawIndex) : this.dragFromIndex;
				if (fromIndex === null || Number.isNaN(fromIndex) || fromIndex === index) {
					return;
				}
				void this.runAction('Saved new queue order', () => this.host.moveTrackInPlaylist(fromIndex, index));
			});

			const thumb = row.createDiv({ cls: 'onp-row-thumb' });
			thumb.setCssProps({ '--onp-thumb-image': `url("${track.thumbnailUrl}")` });
			const thumbPlay = thumb.createDiv({ cls: 'onp-row-thumb-play' });
			setIcon(thumbPlay, 'play');
			thumb.addEventListener('click', () => {
				void this.runAction(`Playing ${track.title}`, () => this.host.playTrack(track.path));
			});

			const body = row.createDiv({ cls: 'onp-row-copy' });
			const title = body.createDiv({ cls: 'onp-row-title', text: track.title });
			title.setAttribute('title', track.path);
			body.createDiv({
				cls: 'onp-row-subtitle',
				text: track.artist || 'Unknown artist',
			});
			body.addEventListener('click', () => {
				void this.runAction(`Playing ${track.title}`, () => this.host.playTrack(track.path));
			});

			const rowActions = row.createDiv({ cls: 'onp-row-actions' });
			if (state.currentTrack?.path === track.path) {
				const eqBars = rowActions.createDiv({ cls: 'onp-row-state onp-eq-bars' });
				eqBars.setAttribute('aria-label', 'Playing');
				eqBars.setAttribute('title', 'Playing');
				eqBars.createDiv({ cls: 'onp-eq-bar' });
				eqBars.createDiv({ cls: 'onp-eq-bar' });
				eqBars.createDiv({ cls: 'onp-eq-bar' });
			}
			rowActions.appendChild(this.createMenuButton('Track actions', 'more-vertical', (event) => {
				this.openTrackMenu(event, track);
			}));
		});
	}

	private openPlaylistMenu(event: MouseEvent, selectedPlaylist: PlaylistSummary): void {
		const menu = new Menu();

		menu.addItem((item) =>
			item
				.setTitle('Open playlist note')
				.setIcon('file-text')
				.onClick(() => {
					void this.runAction('', () => this.host.openPlaylist(selectedPlaylist.path), false);
				}),
		);

		if (this.host.selectActivePlaylist) {
			menu.addItem((item) =>
				item
					.setTitle('Load active playlist note')
					.setIcon('crosshair')
					.onClick(() => {
						void this.runAction('Loaded active playlist', () => this.host.selectActivePlaylist?.() ?? Promise.resolve());
					}),
			);
		}

		if (this.host.addActiveNoteToPlaylist) {
			menu.addItem((item) =>
				item
					.setTitle('Add active note')
					.setIcon('plus')
					.onClick(() => {
						void this.runAction('Added active note to playlist', () => this.host.addActiveNoteToPlaylist?.() ?? Promise.resolve());
					}),
			);
		}

		if (this.host.openBase) {
			menu.addItem((item) =>
				item
					.setTitle('Open Music.base')
					.setIcon('table-2')
					.onClick(() => {
						void this.runAction('', () => this.host.openBase?.('music') ?? Promise.resolve(), false);
					}),
			);
			menu.addItem((item) =>
				item
					.setTitle('Open Playlists.base')
					.setIcon('files')
					.onClick(() => {
						void this.runAction('', () => this.host.openBase?.('playlists') ?? Promise.resolve(), false);
					}),
			);
		}

		if (this.host.refreshCompanionBases) {
			menu.addItem((item) =>
				item
					.setTitle('Refresh companion Bases files')
					.setIcon('layout-grid')
					.onClick(() => {
						void this.runAction('Refreshed companion Bases files', () => this.host.refreshCompanionBases?.() ?? Promise.resolve());
					}),
			);
		}

		menu.addItem((item) =>
			item
				.setTitle('Refresh library')
				.setIcon('refresh-cw')
				.onClick(() => {
					void this.runAction('Refreshed library', () => this.host.refresh());
				}),
		);

		menu.showAtMouseEvent(event);
	}

	private openTrackMenu(event: MouseEvent, track: PlaylistTrack): void {
		const menu = new Menu();

		menu.addItem((item) =>
			item
				.setTitle('Play track')
				.setIcon('play')
				.onClick(() => {
					void this.runAction(`Playing ${track.title}`, () => this.host.playTrack(track.path));
				}),
		);

		menu.addItem((item) =>
			item
				.setTitle('Open note')
				.setIcon('file-text')
				.onClick(() => {
					void this.runAction('', () => this.host.openNote(track.path), false);
				}),
		);

		menu.addItem((item) =>
			item
				.setTitle('Remove from playlist')
				.setIcon('minus-circle')
				.onClick(() => {
					void this.runAction(`Removed ${track.title}`, () => this.host.removeTrackFromPlaylist(track.path));
				}),
		);

		menu.showAtMouseEvent(event);
	}

	private getSelectedPlaylist(state: PlaylistViewState): PlaylistSummary | undefined {
		return state.playlists.find((playlist) => playlist.path === state.selectedPlaylistPath);
	}

	private lookupPlaylistTitle(playlists: PlaylistSummary[], path: string): string {
		return playlists.find((playlist) => playlist.path === path)?.title ?? 'playlist';
	}

	private renderEmptyState(container: HTMLElement, title: string, copy: string): void {
		const state = container.createDiv({ cls: 'onp-empty-state' });
		const icon = state.createDiv({ cls: 'onp-empty-icon' });
		setIcon(icon, 'music-4');
		state.createDiv({ cls: 'onp-empty-title', text: title });
		state.createDiv({ cls: 'onp-empty-copy', text: copy });
	}

	private createActionButton(
		label: string,
		icon: string,
		onClick: () => void,
		options: {
			active?: boolean;
			cta?: boolean;
			iconOnly?: boolean;
		} = {},
	): HTMLButtonElement {
		const button = document.createElement('button');
		button.type = 'button';
		button.className = this.buildRowClass('onp-button', {
			'is-active': Boolean(options.active),
			'is-icon-only': Boolean(options.iconOnly),
			'mod-cta': Boolean(options.cta),
		});
		button.setAttribute('aria-label', label);
		button.setAttribute('title', label);
		const iconEl = button.createSpan({ cls: 'onp-button-icon' });
		setIcon(iconEl, icon);
		if (!options.iconOnly) {
			button.createSpan({ cls: 'onp-button-label', text: label });
		}
		button.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			onClick();
		});
		return button;
	}

	private createIconButton(
		label: string,
		icon: string,
		onClick: () => void,
	): HTMLButtonElement {
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'clickable-icon onp-icon-button';
		button.setAttribute('aria-label', label);
		button.setAttribute('title', label);
		setIcon(button, icon);
		button.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			onClick();
		});
		return button;
	}

	private createMenuButton(
		label: string,
		icon: string,
		onClick: (event: MouseEvent) => void,
	): HTMLButtonElement {
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'clickable-icon onp-icon-button';
		button.setAttribute('aria-label', label);
		button.setAttribute('title', label);
		setIcon(button, icon);
		button.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			onClick(event);
		});
		return button;
	}

	private buildRowClass(base: string, flags: Record<string, boolean>): string {
		return [base, ...Object.entries(flags).filter(([, enabled]) => enabled).map(([name]) => name)].join(' ');
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
		const elements = this.elements;
		if (!elements?.progressFill || !elements.progressTime) return;

		const currentTime = this.playerSurface.getCurrentTime();
		const duration = this.playerSurface.getDuration();

		const ratio = duration > 0 ? Math.min(currentTime / duration, 1) : 0;
		const nextWidth = `${(ratio * 100).toFixed(2)}%`;
		const nextTime = `${formatTime(currentTime)} / ${formatTime(duration)}`;

		elements.progressFill.setCssProps({ '--onp-progress-width': nextWidth });
		if (elements.progressTime.textContent !== nextTime) {
			elements.progressTime.textContent = nextTime;
		}
	}

	private async toggleCurrentPlayback(current: PlaylistTrack): Promise<void> {
		const playbackState = this.host.getState().playbackState;
		if (playbackState === 'playing') {
			this.playerSurface.pause();
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
				currentValue ? 'Autoplay disabled' : 'Autoplay enabled',
				() => this.host.setAutoplayEnabled?.(!currentValue) ?? Promise.resolve(),
			);
			return;
		}

		if (this.host.toggleAutoplay) {
			await this.runAction(
				currentValue ? 'Autoplay disabled' : 'Autoplay enabled',
				() => this.host.toggleAutoplay?.() ?? Promise.resolve(),
			);
		}
	}

	private openCreatePlaylistModal(): void {
		new PlaylistNameModal(this.app, (name) => {
			void this.runAction(`Created ${name}`, () => this.host.createPlaylist(name));
		}).open();
	}

	private async runAction(
		successMessage: string,
		action: () => Promise<void>,
		showSuccess = true,
	): Promise<void> {
		if (this.actionInFlight) return;
		this.actionInFlight = true;

		try {
			await action();
			if (showSuccess && successMessage) {
				new Notice(successMessage, 1800);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			new Notice(message);
		} finally {
			this.actionInFlight = false;
			this.render();
		}
	}
}

