/** Collapses a burst of calls into one `run` on the next `schedule` tick. */
export function coalesce(schedule: (callback: () => void) => void, run: () => void): () => void {
	let pending = false;
	return () => {
		if (pending) return;
		pending = true;
		schedule(() => {
			pending = false;
			run();
		});
	};
}
