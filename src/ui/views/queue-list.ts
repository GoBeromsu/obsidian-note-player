import { setIcon } from 'obsidian';
import { LOADING_TITLE, titleState, trackLabel } from '../../domain/track-import';
import { buildYoutubeThumbnailUrl } from '../../utils/youtube';
import type { PendingImport, PlaylistSummary, PlaylistTrack, PlaylistViewHost, PlaylistViewState } from '../../types/view';
import { openTrackMenu } from './view-menus';
import { buildClass, createIconButton, renderEmptyState, thumbnailSrc, type RunAction } from './view-parts';

export interface QueueContext {
	host: PlaylistViewHost;
	run: RunAction;
	selectedPlaylist: PlaylistSummary | undefined;
}

const renderedSignatures = new WeakMap<HTMLElement, string>();

// The real row lands a few awaits before the import settles; hide the placeholder as soon as it does.
function visiblePending(state: PlaylistViewState): PendingImport[] {
	return state.pendingImports.filter((p) => !p.videoId || !state.queue.some((t) => t.videoId === p.videoId));
}

function queueSignature(state: PlaylistViewState, ctx: QueueContext): string {
	const rows = state.queue.map((t) => [t.path, t.title, t.artist, thumbnailSrc(ctx.host, t.videoId, t.thumbnailUrl), state.loadingTitles.has(t.videoId)].join('\u0001'));
	const pending = visiblePending(state).map((p) => [p.id, p.title ?? ''].join('\u0001'));
	return [ctx.selectedPlaylist?.path ?? '', ctx.selectedPlaylist?.title ?? '', state.errorMessage ?? '', ...rows, ...pending].join('\u0002');
}

// Same rows, new current track: toggle in place so the highlight transition can run.
function syncCurrentRow(panel: HTMLElement, state: PlaylistViewState): boolean {
	const rows = Array.from(panel.querySelectorAll<HTMLElement>('.onp-queue-list > .onp-track-row:not(.is-importing)'));
	if (rows.length !== state.queue.length) return false;
	rows.forEach((row, index) => {
		const isCurrent = state.currentTrack?.path === state.queue[index]?.path;
		row.toggleClass('is-current', isCurrent);
		const actions = row.querySelector<HTMLElement>('.onp-row-actions');
		const bars = actions?.querySelector<HTMLElement>('.onp-eq-bars');
		if (isCurrent && actions && !bars) renderEqBars(actions, state);
		else if (isCurrent && bars) syncEqBars(bars, state);
		if (!isCurrent) bars?.remove();
	});
	return true;
}

function renderEqBars(actions: HTMLElement, state: PlaylistViewState): void {
	const eqBars = createDiv({ cls: 'onp-row-state onp-eq-bars' });
	for (let i = 0; i < 3; i++) eqBars.createDiv({ cls: 'onp-eq-bar' });
	syncEqBars(eqBars, state);
	actions.prepend(eqBars);
}

function syncEqBars(eqBars: HTMLElement, state: PlaylistViewState): void {
	const playing = state.playbackState === 'playing';
	const label = state.playbackState === 'loading' ? 'Loading' : playing ? 'Playing' : 'Paused';
	eqBars.toggleClass('is-paused', !playing);
	eqBars.setAttribute('aria-label', label);
	eqBars.setAttribute('title', label);
}

export function renderQueue(panel: HTMLElement, state: PlaylistViewState, ctx: QueueContext): void {
	const signature = queueSignature(state, ctx);
	if (renderedSignatures.get(panel) === signature && syncCurrentRow(panel, state)) return;
	renderedSignatures.set(panel, signature);
	panel.empty();

	if (state.errorMessage) {
		renderEmptyState(panel, 'Playlist error', state.errorMessage);
		return;
	}

	const pending = visiblePending(state);
	const hasPending = pending.length > 0;
	if (!ctx.selectedPlaylist && !hasPending) {
		renderEmptyState(panel, 'Choose a playlist', 'The playlist rows appear here once you select a playlist.');
		return;
	}
	if (state.queue.length === 0 && !hasPending) {
		renderEmptyState(panel, 'Playlist is empty', 'Paste a YouTube URL here or use the link button to add a track.');
		return;
	}

	const list = panel.createDiv({ cls: 'onp-list onp-queue-list' });
	state.queue.forEach((track, index) => renderRow(list, state, ctx, track, index));
	pending.forEach((entry, offset) => renderPendingRow(list, ctx.host, entry, state.queue.length + offset));
}

/** The music note stays under the image, so it shows while the thumbnail loads, or for good when it is missing or broken. */
function createRowThumb(row: HTMLElement, url: string | null): HTMLElement {
	const thumb = row.createDiv({ cls: 'onp-row-thumb' });
	setIcon(thumb.createDiv({ cls: 'onp-row-thumb-placeholder' }), 'music');
	if (!url) return thumb;
	const img = thumb.createEl('img', { cls: 'onp-row-thumb-img', attr: { src: url, alt: '', loading: 'lazy' } });
	// Already-cached images skip the fade so re-rendered rows don't flicker.
	if (img.complete && img.naturalWidth > 0) img.addClass('is-loaded');
	else {
		img.addEventListener('load', () => img.addClass('is-loaded'), { once: true });
		img.addEventListener('error', () => img.remove(), { once: true });
	}
	return thumb;
}

function renderPendingRow(list: HTMLElement, host: PlaylistViewHost, entry: PendingImport, index: number): void {
	const row = list.createDiv({ cls: 'onp-track-row is-importing' });
	row.setAttribute('aria-busy', 'true');
	row.createDiv({ cls: 'onp-row-number' }).createSpan({ cls: 'onp-row-order', text: String(index + 1).padStart(2, '0') });
	createRowThumb(row, entry.videoId ? thumbnailSrc(host, entry.videoId, buildYoutubeThumbnailUrl(entry.videoId)) : null);
	const body = row.createDiv({ cls: 'onp-row-copy' });
	body.createDiv({ cls: 'onp-row-title', text: entry.title ?? (entry.videoId ? 'Importing…' : 'Importing playlist…') });
	body.createDiv({ cls: 'onp-row-subtitle', text: entry.title ? 'Adding to playlist…' : 'Fetching details…' });
	// Reserve the track-menu button's footprint so the row keeps its width when it becomes real.
	const placeholder = row.createDiv({ cls: 'onp-row-actions' }).createSpan({ cls: 'clickable-icon onp-icon-button onp-row-action-placeholder' });
	placeholder.setAttribute('aria-hidden', 'true');
	setIcon(placeholder, 'more-vertical');
}

const unavailableSeen = new Set<string>();

function renderRow(
	list: HTMLElement,
	state: PlaylistViewState,
	ctx: QueueContext,
	track: PlaylistTrack,
	index: number,
): void {
	const { host, run } = ctx;
	const isCurrent = state.currentTrack?.path === track.path;
	const row = list.createDiv({
		cls: buildClass('onp-track-row', {
			'is-current': isCurrent,
		}),
	});

	row.createDiv({ cls: 'onp-row-number' }).createSpan({ cls: 'onp-row-order', text: String(index + 1).padStart(2, '0') });

	const play = () => {
		void run('', () => host.playTrack(track.path), false);
	};

	const thumb = createRowThumb(row, thumbnailSrc(host, track.videoId, track.thumbnailUrl));
	setIcon(thumb.createDiv({ cls: 'onp-row-thumb-play' }), 'play');
	thumb.addEventListener('click', play);

	const body = row.createDiv({ cls: 'onp-row-copy' });
	const titleStatus = titleState(track, state.loadingTitles.has(track.videoId));
	const unavailable = titleStatus === 'unavailable';
	const loading = titleStatus === 'loading';
	// A row last drawn as unavailable that now has a real title was just healed; fade the new text in.
	const healed = titleStatus === 'ready' && unavailableSeen.delete(track.videoId);
	if (titleStatus !== 'ready') unavailableSeen.add(track.videoId);
	body.createDiv({
		cls: buildClass('onp-row-title', { 'is-unavailable': unavailable, 'is-resolving': loading, 'is-healed': healed }),
		text: loading ? track.title : trackLabel(track),
	}).setAttribute('title', track.path);
	const subtitle = track.artist || (unavailable ? "Couldn't load" : loading ? LOADING_TITLE : '');
	if (subtitle) body.createDiv({ cls: buildClass('onp-row-subtitle', { 'is-healed': healed, 'is-resolving': loading }), text: subtitle });
	body.addEventListener('click', play);

	const rowActions = row.createDiv({ cls: 'onp-row-actions' });
	if (isCurrent) {
		renderEqBars(rowActions, state);
	}
	rowActions.appendChild(createIconButton('Track actions', 'more-vertical', (event) => {
		openTrackMenu(event, host, track, run);
	}));
}
