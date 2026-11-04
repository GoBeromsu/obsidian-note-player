import { describe, expect, it } from 'vitest';
import { coalesce } from '../src/utils/coalesce';

function fakeTicks() {
	const pending = new Set<() => void>();
	let cancels = 0;
	const schedule = (callback: () => void) => {
		pending.add(callback);
		return () => {
			cancels += 1;
			pending.delete(callback);
		};
	};
	const flush = () => {
		const due = [...pending];
		pending.clear();
		for (const callback of due) callback();
	};
	return { schedule, flush, pending, cancels: () => cancels };
}

describe('coalesce', () => {
	it('runs once per scheduled tick however many calls arrive, and re-arms after', () => {
		const ticks = fakeTicks();
		let runs = 0;
		const trigger = coalesce(ticks.schedule, () => { runs += 1; });

		trigger();
		trigger();
		trigger();
		expect(ticks.pending.size).toBe(1);
		expect(runs).toBe(0);

		ticks.flush();
		expect(runs).toBe(1);

		trigger();
		expect(ticks.pending.size).toBe(1);
		ticks.flush();
		expect(runs).toBe(2);
	});

	it('cancel drops the pending run and the next call schedules again', () => {
		const ticks = fakeTicks();
		let runs = 0;
		const trigger = coalesce(ticks.schedule, () => { runs += 1; });

		trigger.cancel();
		expect(ticks.cancels()).toBe(0);

		trigger();
		trigger.cancel();
		expect(ticks.pending.size).toBe(0);
		expect(ticks.cancels()).toBe(1);
		ticks.flush();
		expect(runs).toBe(0);

		trigger();
		ticks.flush();
		expect(runs).toBe(1);
	});
});
