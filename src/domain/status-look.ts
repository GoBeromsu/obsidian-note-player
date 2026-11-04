export type StatusTone = 'idle' | 'busy' | 'live' | 'playing' | 'done' | 'warn' | 'failed';
export type StatusPlayback = 'playing' | 'paused' | 'idle';
export type StatusAction = 'cancel' | 'retry' | 'open';

export interface StatusLook {
	icon: string;
	text: string;
	tone: StatusTone;
}

const TITLE_MAX = 28;

export function clipTitle(title: string): string {
	return title.length > TITLE_MAX ? `${title.slice(0, TITLE_MAX - 1).trimEnd()}…` : title;
}

/** What the bar shows when nothing is downloading or failing: the track, in the state it is in. */
export function restingLook(title: string | null, playback: StatusPlayback, streaming: boolean): StatusLook {
	const name = title ? clipTitle(title) : null;
	if (streaming && playback !== 'paused') return { icon: 'radio', text: name ?? 'Streaming', tone: 'live' };
	if (!name) return { icon: 'music', text: 'Note Player', tone: 'idle' };
	if (playback === 'paused') return { icon: 'pause', text: name, tone: 'idle' };
	return { icon: 'audio-lines', text: name, tone: playback === 'playing' ? 'playing' : 'idle' };
}

/** Screen-reader text for the resting bar: the state, then the full (unclipped) title. */
export function restingLabel(title: string | null, playback: StatusPlayback, shown: string, loading = false): string {
	if (!title || playback === 'idle') return shown;
	return `${playback === 'paused' ? 'Paused' : 'Playing'}: ${loading ? 'loading title…' : title}`;
}

const ACTION_HINT: Record<StatusAction, string> = {
	cancel: 'click to cancel',
	retry: 'click to retry',
	open: 'click to open',
};

export function statusLabel(text: string, action: StatusAction): string {
	return `${text} · ${ACTION_HINT[action]}`;
}
