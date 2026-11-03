import { BasesView, MarkdownView, Notice, setIcon, type QueryController } from 'obsidian';
import { buildPlaylistBasesRows, playlistBasesSignature } from '../../domain/playlist-bases';
import type { PlaylistNote } from '../../types/music';
import type { PlaylistBasesHost, PlaylistBasesRow } from '../../types/playlist-bases';
import { plural } from '../../utils/plural';
import { buildClass, createActionButton, renderEmptyState } from './view-parts';

/** Matches the `type:` the plugin writes into playlist base files. */
export const PLAYLIST_BASES_VIEW_TYPE = 'note-player';

const STANDALONE_SIGNATURE = '\u0000standalone';

interface RowElements {
	path: string;
	row: HTMLElement;
	actions: HTMLElement;
}

/**
 * The "Player" view inside a playlist base. The base query is filter- and limit-applied, so `this.data`
 * only says "something changed"; the rows always come from the host's membership index.
 */
export class PlaylistBasesView extends BasesView {
	readonly type = PLAYLIST_BASES_VIEW_TYPE;
	private readonly rootEl: HTMLElement;
	private readonly host: PlaylistBasesHost;
	private rowEls: RowElements[] = [];
	private renderedSignature: string | null = null;
	private retryFrame: number | null = null;
	private retriedWhileDetached = false;

	constructor(controller: QueryController, containerEl: HTMLElement, host: PlaylistBasesHost) {
		super(controller);
		this.host = host;
		this.rootEl = containerEl.createDiv({ cls: 'onp-bases-view' });
		this.register(host.onStateChange(() => this.render()));
	}

	onDataUpdated(): void {
		this.render();
	}

	onunload(): void {
		this.cancelRetry();
		this.rootEl.remove();
	}

	private render(): void {
		// The embed may report data before its element sits in a leaf; look again once it has been attached.
		if (!this.rootEl.isConnected) {
			if (!this.retriedWhileDetached) {
				this.retriedWhileDetached = true;
				this.retryFrame = this.rootEl.win.requestAnimationFrame(() => {
					this.retryFrame = null;
					this.render();
				});
			}
			return;
		}
		this.cancelRetry();
		this.retriedWhileDetached = false;

		const companionPath = this.resolveCompanionPath();
		const playlist = companionPath ? this.host.getPlaylistByPath(companionPath) : null;
		if (!playlist) {
			this.renderStandalone();
			return;
		}

		const rows = buildPlaylistBasesRows(playlist, this.host.getState().currentTrack?.path ?? null);
		const signature = playlistBasesSignature(playlist, rows);
		if (signature === this.renderedSignature) {
			this.syncCurrentRows(rows);
			return;
		}
		this.renderedSignature = signature;
		this.rootEl.empty();
		this.rowEls = [];
		this.renderHeader(playlist, rows.length);
		if (rows.length === 0) {
			renderEmptyState(this.rootEl, 'No tracks yet', 'Tracks linked to this playlist appear here.');
			return;
		}
		const list = this.rootEl.createDiv({ cls: 'onp-list onp-queue-list' });
		for (const row of rows) this.renderRow(list, playlist.path, row);
	}

	private resolveCompanionPath(): string | null {
		const found: { path: string | null } = { path: null };
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (found.path !== null) return;
			const view = leaf.view;
			if (view instanceof MarkdownView && view.containerEl.contains(this.rootEl)) found.path = view.file?.path ?? null;
		});
		return found.path;
	}

	private renderStandalone(): void {
		if (this.renderedSignature === STANDALONE_SIGNATURE) return;
		this.renderedSignature = STANDALONE_SIGNATURE;
		this.rowEls = [];
		this.rootEl.empty();
		renderEmptyState(this.rootEl, "Open this playlist's note to play it.", 'The player follows the note that embeds this base.');
	}

	private renderHeader(playlist: PlaylistNote, count: number): void {
		const header = this.rootEl.createDiv({ cls: 'onp-bases-header' });
		const heading = header.createDiv({ cls: 'onp-bases-heading' });
		heading.createDiv({ cls: 'onp-bases-title', text: playlist.title });
		heading.createDiv({ cls: 'onp-bases-count', text: plural(count, 'track') });
		const play = createActionButton('Play', 'play', () => this.play(playlist.path, null), { cta: true });
		play.disabled = count === 0;
		header.appendChild(play);
	}

	private renderRow(list: HTMLElement, companionPath: string, row: PlaylistBasesRow): void {
		const rowEl = list.createDiv({
			cls: buildClass('onp-track-row', { 'is-current': row.current }),
			attr: { role: 'button', tabindex: '0', 'aria-label': `Play ${row.title}` },
		});
		if (row.current) rowEl.setAttribute('aria-current', 'true');
		rowEl.createDiv({ cls: 'onp-bases-index' }).createSpan({ cls: 'onp-row-order', text: row.order });

		const thumb = this.createThumb(rowEl, row.thumbnailUrl);
		setIcon(thumb.createDiv({ cls: 'onp-row-thumb-play' }), 'play');

		const copy = rowEl.createDiv({ cls: 'onp-row-copy' });
		copy.createDiv({ cls: buildClass('onp-row-title', { 'is-unavailable': row.unavailable }), text: row.title })
			.setAttribute('title', row.path);
		const subtitle = row.artist || (row.unavailable ? "Couldn't load" : '');
		if (subtitle) copy.createDiv({ cls: 'onp-row-subtitle', text: subtitle });

		const actions = rowEl.createDiv({ cls: 'onp-row-actions' });
		if (row.current) this.renderNowMarker(actions);
		this.rowEls.push({ path: row.path, row: rowEl, actions });

		const play = () => this.play(companionPath, row.path);
		rowEl.addEventListener('click', play);
		rowEl.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			play();
		});
	}

	/** The music note stays under the image, so it shows while the thumbnail loads or for good when it is missing. */
	private createThumb(row: HTMLElement, url: string | null): HTMLElement {
		const thumb = row.createDiv({ cls: 'onp-row-thumb' });
		setIcon(thumb.createDiv({ cls: 'onp-row-thumb-placeholder' }), 'music');
		if (!url) return thumb;
		const img = thumb.createEl('img', { cls: 'onp-row-thumb-img', attr: { src: url, alt: '', loading: 'lazy' } });
		if (img.complete && img.naturalWidth > 0) img.addClass('is-loaded');
		else {
			img.addEventListener('load', () => img.addClass('is-loaded'), { once: true });
			img.addEventListener('error', () => img.remove(), { once: true });
		}
		return thumb;
	}

	private renderNowMarker(actions: HTMLElement): void {
		const marker = actions.createDiv({ cls: 'onp-row-state onp-bases-now', attr: { 'aria-label': 'Current track', title: 'Current track' } });
		setIcon(marker, 'audio-lines');
	}

	/** Same rows, new current track: toggle in place so the highlight transition can run. */
	private syncCurrentRows(rows: readonly PlaylistBasesRow[]): void {
		const currentPaths = new Set(rows.filter((row) => row.current).map((row) => row.path));
		for (const { path, row, actions } of this.rowEls) {
			const isCurrent = currentPaths.has(path);
			row.toggleClass('is-current', isCurrent);
			if (isCurrent) row.setAttribute('aria-current', 'true');
			else row.removeAttribute('aria-current');
			const marker = actions.querySelector('.onp-bases-now');
			if (isCurrent && !marker) this.renderNowMarker(actions);
			else if (!isCurrent) marker?.remove();
		}
	}

	private play(companionPath: string, trackPath: string | null): void {
		this.host.playPlaylist(companionPath, trackPath).catch((error: unknown) => {
			console.error('[Note Player] Could not play from the playlist base', error);
			new Notice("That didn't work. Try again.");
		});
	}

	private cancelRetry(): void {
		if (this.retryFrame === null) return;
		this.rootEl.win.cancelAnimationFrame(this.retryFrame);
		this.retryFrame = null;
	}
}
