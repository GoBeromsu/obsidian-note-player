/** Schedules `callback` once and returns a function that cancels it if it has not run yet. */
export type Schedule = (callback: () => void) => () => void;

export interface Coalesced {
	(): void;
	cancel(): void;
}

/** Collapses a burst of calls into one `run` on the next `schedule` tick. */
export function coalesce(schedule: Schedule, run: () => void): Coalesced {
	let cancelPending: (() => void) | null = null;
	const trigger = (): void => {
		if (cancelPending) return;
		cancelPending = schedule(() => {
			cancelPending = null;
			run();
		});
	};
	return Object.assign(trigger, {
		cancel: (): void => {
			cancelPending?.();
			cancelPending = null;
		},
	});
}
