import { describe, expect, it } from 'vitest';
import { coalesce } from '../src/utils/coalesce';

describe('coalesce', () => {
	it('runs once per scheduled tick however many calls arrive, and re-arms after', () => {
		const ticks: Array<() => void> = [];
		let runs = 0;
		const trigger = coalesce((callback) => ticks.push(callback), () => { runs += 1; });

		trigger();
		trigger();
		trigger();
		expect(ticks).toHaveLength(1);
		expect(runs).toBe(0);

		ticks.shift()!();
		expect(runs).toBe(1);

		trigger();
		expect(ticks).toHaveLength(1);
		ticks.shift()!();
		expect(runs).toBe(2);
	});
});
