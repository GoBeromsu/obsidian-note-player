import { requestUrl, type DataAdapter, type Plugin } from 'obsidian';
import { THUMBNAIL_CACHE_FOLDER, thumbnailCachePath, ThumbnailQueue, videoIdFromCachePath } from '../domain/thumbnail-cache';
import type { ThumbnailCachePort } from '../types/view';
import { buildYoutubeThumbnailUrl } from '../utils/youtube';

type ThumbnailAdapter = Pick<DataAdapter, 'exists' | 'list' | 'mkdir' | 'rmdir' | 'writeBinary' | 'getResourcePath'>;

async function fetchThumbnail(url: string): Promise<ArrayBuffer | null> {
	const response = await requestUrl({ url, throw: false });
	return response.status === 200 ? response.arrayBuffer : null;
}

export class ThumbnailCacheService implements ThumbnailCachePort {
	/** Video id => resource path; null until the folder is listed on first use (never at startup), and while a clear runs. */
	private cached: Map<string, string> | null = null;
	private seeding = false;
	private readonly awaitingSeed = new Set<string>();
	private dirReady = false;
	/** Bumped by clear() and dispose() so a listing that started before them cannot repopulate the map. */
	private epoch = 0;
	private clearing: Promise<void> | null = null;
	private disposed = false;
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

	static attach(plugin: Plugin, onChange: () => void): ThumbnailCacheService {
		const pluginDir = plugin.manifest.dir ?? `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}`;
		const cache = new ThumbnailCacheService(plugin.app.vault.adapter, `${pluginDir}/${THUMBNAIL_CACHE_FOLDER}`);
		plugin.register(cache.subscribe(onChange));
		plugin.register(() => cache.dispose());
		return cache;
	}

	resolve(videoId: string): string {
		if (!videoId) return '';
		const remote = buildYoutubeThumbnailUrl(videoId);
		if (this.disposed || !thumbnailCachePath(this.cacheDir, videoId)) return remote;
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

	/** Renders during the clear get remote URLs; downloads and the re-seed wait until the folder is gone. */
	clear(): Promise<void> {
		if (this.disposed) return Promise.resolve();
		if (this.clearing) return this.clearing;
		this.invalidate();
		this.clearing = this.removeFolder().finally(() => {
			this.clearing = null;
			if (this.disposed) return;
			if (this.awaitingSeed.size > 0) this.seed();
			this.emit();
		});
		this.emit();
		return this.clearing;
	}

	dispose(): void {
		this.disposed = true;
		this.invalidate();
		this.awaitingSeed.clear();
		this.listeners.clear();
	}

	private invalidate(): void {
		this.epoch++;
		this.seeding = false;
		this.cached = null;
		this.dirReady = false;
		this.queue.reset();
	}

	private async removeFolder(): Promise<void> {
		if (await this.adapter.exists(this.cacheDir)) await this.adapter.rmdir(this.cacheDir, true);
	}

	private seed(): void {
		if (this.seeding || this.clearing || this.disposed) return;
		this.seeding = true;
		const epoch = this.epoch;
		void this.listCachedIds()
			.catch((error: unknown) => {
				console.debug('[Note Player] Could not read the thumbnail cache', error);
				return { exists: false, ids: [] };
			})
			.then(({ exists, ids }) => {
				if (epoch !== this.epoch) return;
				this.seeding = false;
				this.dirReady = exists;
				this.cached = new Map();
				for (const id of ids) this.remember(id);
				const waiting = [...this.awaitingSeed];
				this.awaitingSeed.clear();
				for (const id of waiting) this.resolve(id);
				if (waiting.some((id) => this.cached?.has(id))) this.emit();
			});
	}

	private async listCachedIds(): Promise<{ exists: boolean; ids: string[] }> {
		if (!(await this.adapter.exists(this.cacheDir))) return { exists: false, ids: [] };
		const { files } = await this.adapter.list(this.cacheDir);
		return { exists: true, ids: files.map(videoIdFromCachePath).filter((id): id is string => id !== null) };
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
				if (isStale()) return false;
				this.dirReady = true;
			}
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
