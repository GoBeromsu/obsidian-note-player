import { requestUrl, type DataAdapter } from 'obsidian';
import { thumbnailCachePath, ThumbnailQueue, videoIdFromCachePath } from '../domain/thumbnail-cache';
import type { ThumbnailCachePort } from '../types/view';
import { buildYoutubeThumbnailUrl } from '../utils/youtube';

type ThumbnailAdapter = Pick<DataAdapter, 'exists' | 'list' | 'mkdir' | 'rmdir' | 'writeBinary' | 'getResourcePath'>;

async function fetchThumbnail(url: string): Promise<ArrayBuffer | null> {
	const response = await requestUrl({ url, throw: false });
	return response.status === 200 ? response.arrayBuffer : null;
}

export class ThumbnailCacheService implements ThumbnailCachePort {
	/** Video id => resource path; null until the folder is listed on first use, never at startup. */
	private cached: Map<string, string> | null = null;
	private seeding = false;
	private readonly awaitingSeed = new Set<string>();
	private dirReady = false;
	private readonly listeners = new Set<() => void>();
	private readonly queue = new ThumbnailQueue(
		(videoId, isStale) => this.download(videoId, isStale),
		(videoId, written) => {
			if (!written) return;
			this.remember(videoId);
			this.emit();
		},
	);
	/** Swappable so QA can simulate an offline network. */
	fetchImage: (url: string) => Promise<ArrayBuffer | null> = fetchThumbnail;

	constructor(private readonly adapter: ThumbnailAdapter, private readonly cacheDir: string) {}

	resolve(videoId: string): string {
		if (!videoId) return '';
		const remote = buildYoutubeThumbnailUrl(videoId);
		if (!thumbnailCachePath(this.cacheDir, videoId)) return remote;
		if (!this.cached) {
			this.awaitingSeed.add(videoId);
			this.seed();
			return remote;
		}
		const local = this.cached.get(videoId);
		if (local) return local;
		this.queue.request(videoId);
		return remote;
	}

	subscribe(onChange: () => void): () => void {
		this.listeners.add(onChange);
		return () => this.listeners.delete(onChange);
	}

	async clear(): Promise<void> {
		this.queue.reset();
		this.awaitingSeed.clear();
		this.cached = new Map();
		this.dirReady = false;
		if (await this.adapter.exists(this.cacheDir)) await this.adapter.rmdir(this.cacheDir, true);
		this.emit();
	}

	dispose(): void {
		this.queue.reset();
		this.listeners.clear();
	}

	private seed(): void {
		if (this.seeding) return;
		this.seeding = true;
		void this.listCachedIds()
			.catch((error: unknown) => {
				console.debug('[Note Player] Could not read the thumbnail cache', error);
				return [];
			})
			.then((ids) => {
				this.seeding = false;
				// A clear() during the listing already set the map; its files are gone.
				if (!this.cached) {
					this.cached = new Map();
					for (const id of ids) this.remember(id);
				}
				const waiting = [...this.awaitingSeed];
				this.awaitingSeed.clear();
				for (const id of waiting) this.resolve(id);
				if (waiting.some((id) => this.cached?.has(id))) this.emit();
			});
	}

	private async listCachedIds(): Promise<string[]> {
		if (!(await this.adapter.exists(this.cacheDir))) return [];
		this.dirReady = true;
		const { files } = await this.adapter.list(this.cacheDir);
		return files.map(videoIdFromCachePath).filter((id): id is string => id !== null);
	}

	private async download(videoId: string, isStale: () => boolean): Promise<boolean> {
		const path = thumbnailCachePath(this.cacheDir, videoId);
		if (!path) return false;
		try {
			const data = await this.fetchImage(buildYoutubeThumbnailUrl(videoId));
			if (!data || data.byteLength === 0) {
				console.debug('[Note Player] No thumbnail for', videoId);
				return false;
			}
			if (isStale()) return false;
			if (!this.dirReady) {
				if (!(await this.adapter.exists(this.cacheDir))) await this.adapter.mkdir(this.cacheDir);
				this.dirReady = true;
			}
			if (isStale()) return false;
			await this.adapter.writeBinary(path, data);
			return true;
		} catch (error) {
			console.debug('[Note Player] Thumbnail download failed for', videoId, error);
			return false;
		}
	}

	// Memoized so a re-render sees the same src and its row signature stays stable.
	private remember(videoId: string): void {
		const path = thumbnailCachePath(this.cacheDir, videoId);
		if (path && this.cached && !this.cached.has(videoId)) this.cached.set(videoId, this.adapter.getResourcePath(path));
	}

	private emit(): void {
		for (const listener of this.listeners) listener();
	}
}
