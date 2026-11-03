import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Plugin } from 'obsidian';
import { ThumbnailCacheService } from '../src/services/thumbnail-cache';

vi.mock('obsidian', () => ({ requestUrl: vi.fn() }));

const DIR = 'cfg/plugins/note-player/thumbnail-cache';
const ID = 'aaaaaaaaaaa';
const PATH = `${DIR}/${ID}.jpg`;
const REMOTE = `https://i.ytimg.com/vi/${ID}/hqdefault.jpg`;

function deferred<T = void>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((res) => { resolve = res; });
	return { promise, resolve };
}

/** One check-phase turn drains every pending microtask continuation; no wall-clock wait. */
const drain = () => new Promise<void>((resolve) => setImmediate(resolve));

function fakeAdapter(files: Set<string>, ops: string[]) {
	return {
		exists: vi.fn(async (path: string) => path === DIR ? [...files].some((f) => f.startsWith(`${DIR}/`)) || ops.includes('mkdir') : files.has(path)),
		list: vi.fn(async () => ({ files: [...files], folders: [] as string[] })),
		mkdir: vi.fn(async () => { ops.push('mkdir'); }),
		rmdir: vi.fn(async () => { files.clear(); ops.push('rmdir'); }),
		writeBinary: vi.fn(async (path: string) => { files.add(path); ops.push(`write:${path}`); }),
		getResourcePath: (path: string) => `app://local/${path}`,
	};
}

describe('ThumbnailCacheService lifecycle', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('cancels a pending notification frame on unload, through the window that booked it', async () => {
		const frames = new Map<number, () => void>();
		const booked = deferred();
		let nextHandle = 0;
		const win = {
			requestAnimationFrame: vi.fn((callback: () => void) => {
				frames.set(++nextHandle, callback);
				booked.resolve();
				return nextHandle;
			}),
			cancelAnimationFrame: vi.fn((handle: number) => { frames.delete(handle); }),
		};
		vi.stubGlobal('activeWindow', win);
		const unloaders: Array<() => void> = [];
		const plugin = {
			manifest: { id: 'note-player', dir: 'cfg/plugins/note-player' },
			app: { vault: { configDir: 'cfg', adapter: fakeAdapter(new Set([PATH]), []) } },
			register: (callback: () => void) => { unloaders.push(callback); },
		} as unknown as Plugin;
		const onChange = vi.fn();
		const cache = ThumbnailCacheService.attach(plugin, onChange);

		expect(cache.resolve(ID)).toBe(REMOTE);
		await booked.promise;
		expect([...frames.keys()]).toEqual([1]);

		// Swap the active window as a popout gaining focus would; the cancel must still reach the booking window.
		vi.stubGlobal('activeWindow', { requestAnimationFrame: vi.fn(), cancelAnimationFrame: vi.fn() });
		for (const unload of unloaders) unload();

		expect(win.cancelAnimationFrame).toHaveBeenCalledWith(1);
		expect(frames.size).toBe(0);
		expect(onChange).not.toHaveBeenCalled();
	});

	it('starts no download once disposed while the first folder listing is pending', async () => {
		const ops: string[] = [];
		const adapter = fakeAdapter(new Set(), ops);
		const listing = deferred<{ files: string[]; folders: string[] }>();
		const listStarted = deferred();
		adapter.exists.mockResolvedValue(true);
		adapter.list.mockImplementation(() => { listStarted.resolve(); return listing.promise; });
		const service = new ThumbnailCacheService(adapter, DIR);
		service.fetchImage = vi.fn(async () => new ArrayBuffer(8));

		expect(service.resolve(ID)).toBe(REMOTE);
		await listStarted.promise;
		service.dispose();
		listing.resolve({ files: [], folders: [] });
		await drain();

		expect(service.fetchImage).not.toHaveBeenCalled();
		expect(ops).toEqual([]);
		expect(service.resolve(ID)).toBe(REMOTE);
	});

	it('never serves a local URL for a file a running clear is deleting, and re-downloads after it', async () => {
		const files = new Set([PATH]);
		const ops: string[] = [];
		const adapter = fakeAdapter(files, ops);
		const rmdirStarted = deferred();
		const releaseRmdir = deferred();
		adapter.rmdir.mockImplementation(async () => {
			rmdirStarted.resolve();
			await releaseRmdir.promise;
			files.clear();
			ops.push('rmdir');
		});
		const service = new ThumbnailCacheService(adapter, DIR);
		service.fetchImage = vi.fn(async () => new ArrayBuffer(8));
		let changed = deferred();
		service.subscribe(() => changed.resolve());

		service.resolve(ID);
		await changed.promise;
		expect(service.resolve(ID)).toBe(`app://local/${PATH}`);

		changed = deferred();
		const clearing = service.clear();
		expect(service.resolve(ID)).toBe(REMOTE);
		await rmdirStarted.promise;
		expect(service.resolve(ID)).toBe(REMOTE);
		await drain();
		expect(service.fetchImage).not.toHaveBeenCalled();

		releaseRmdir.resolve();
		await clearing;
		expect(files.has(PATH)).toBe(false);
		expect(service.resolve(ID)).toBe(REMOTE);

		const rewritten = deferred();
		service.subscribe(() => { if (files.has(PATH)) rewritten.resolve(); });
		await rewritten.promise;
		expect(ops).toEqual(['rmdir', 'mkdir', `write:${PATH}`]);
		expect(service.resolve(ID)).toBe(`app://local/${PATH}`);
		expect(service.fetchImage).toHaveBeenCalledTimes(1);
	});
});
