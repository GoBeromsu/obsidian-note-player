import { describe, expect, it } from 'vitest';
import { MAX_THUMBNAIL_DOWNLOADS, thumbnailCachePath, ThumbnailQueue, videoIdFromCachePath } from '../src/domain/thumbnail-cache';

const DIR = 'cfg/plugins/note-player/thumbnail-cache';
const ids = ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc', 'ddddddddddd', 'eeeeeeeeeee', 'fffffffffff'];

interface Job { id: string; isStale: () => boolean; finish: (written: boolean) => void; fail: (error: Error) => void }

function harness() {
	const jobs: Job[] = [];
	const settled: Array<[string, boolean]> = [];
	const waiters = new Map<string, () => void>();
	const queue = new ThumbnailQueue(
		(id, isStale) => new Promise<boolean>((resolve, reject) => {
			jobs.push({ id, isStale, finish: resolve, fail: reject });
		}),
		(id, written) => {
			settled.push([id, written]);
			waiters.get(id)?.();
		},
	);
	const settle = (id: string) => new Promise<void>((resolve) => waiters.set(id, resolve));
	return { queue, jobs, settled, settle };
}

describe('thumbnailCachePath', () => {
	it('names the file after the video id inside the cache folder', () => {
		expect(thumbnailCachePath(DIR, 'dQw4w9WgXcQ')).toBe(`${DIR}/dQw4w9WgXcQ.jpg`);
	});

	it.each(['', 'short', '../../../etc', 'dQw4w9WgXcQ/', 'dQw4w9WgXc.', ' dQw4w9WgXcQ'])('rejects %j', (id) => {
		expect(thumbnailCachePath(DIR, id)).toBeNull();
	});
});

describe('videoIdFromCachePath', () => {
	it('round-trips a cached file path', () => {
		expect(videoIdFromCachePath(`${DIR}/dQw4w9WgXcQ.jpg`)).toBe('dQw4w9WgXcQ');
	});

	it.each([`${DIR}/dQw4w9WgXcQ.mp3`, `${DIR}/dQw4w9WgXcQ.jpg.tmp`, `${DIR}/notes.jpg`, `${DIR}/.DS_Store`])('ignores %s', (path) => {
		expect(videoIdFromCachePath(path)).toBeNull();
	});
});

describe('ThumbnailQueue', () => {
	it('starts one download for an id requested many times at once', () => {
		const { queue, jobs } = harness();
		const accepted = Array.from({ length: 20 }, () => queue.request(ids[0]!));
		expect(accepted.filter(Boolean)).toHaveLength(1);
		expect(jobs.map((job) => job.id)).toEqual([ids[0]]);
	});

	it(`runs at most ${MAX_THUMBNAIL_DOWNLOADS} downloads and starts the next as one settles`, async () => {
		const { queue, jobs, settle } = harness();
		ids.forEach((id) => queue.request(id));
		expect(jobs.map((job) => job.id)).toEqual(ids.slice(0, 4));
		expect(queue.activeCount).toBe(4);
		expect(queue.waitingCount).toBe(2);

		const done = settle(ids[1]!);
		jobs[1]!.finish(true);
		await done;
		expect(jobs.map((job) => job.id)).toEqual(ids.slice(0, 5));
		expect(queue.activeCount).toBe(4);
		expect(queue.waitingCount).toBe(1);
	});

	it('does not retry an id whose download failed or was rejected', async () => {
		const { queue, jobs, settled, settle } = harness();
		queue.request(ids[0]!);
		queue.request(ids[1]!);
		const both = Promise.all([settle(ids[0]!), settle(ids[1]!)]);
		jobs[0]!.finish(false);
		jobs[1]!.fail(new Error('offline'));
		await both;
		expect(settled).toEqual([[ids[0], false], [ids[1], false]]);

		expect(queue.request(ids[0]!)).toBe(false);
		expect(queue.request(ids[1]!)).toBe(false);
		expect(jobs).toHaveLength(2);
	});

	it('does not download an id again after it was written', async () => {
		const { queue, jobs, settle } = harness();
		queue.request(ids[0]!);
		const done = settle(ids[0]!);
		jobs[0]!.finish(true);
		await done;
		expect(queue.request(ids[0]!)).toBe(false);
		expect(jobs).toHaveLength(1);
	});

	it('settles a job that throws synchronously as a failure', async () => {
		const settled: Array<[string, boolean]> = [];
		let done!: () => void;
		const finished = new Promise<void>((resolve) => { done = resolve; });
		const queue = new ThumbnailQueue(
			() => { throw new Error('boom'); },
			(id, written) => { settled.push([id, written]); done(); },
		);
		queue.request(ids[0]!);
		await finished;
		expect(settled).toEqual([[ids[0], false]]);
	});

	it('downloads again after a reset and ignores the stale job', async () => {
		const { queue, jobs, settled, settle } = harness();
		queue.request(ids[0]!);
		queue.request(ids[1]!);
		const stale = jobs[0]!;
		queue.reset();
		expect(stale.isStale()).toBe(true);
		expect(queue.activeCount).toBe(0);

		expect(queue.request(ids[0]!)).toBe(true);
		const fresh = jobs[2]!;
		expect(fresh.id).toBe(ids[0]);
		expect(fresh.isStale()).toBe(false);

		const done = settle(ids[0]!);
		stale.finish(true);
		fresh.finish(true);
		await done;
		expect(settled).toEqual([[ids[0], true]]);
	});
});
