export const THUMBNAIL_CACHE_FOLDER = 'thumbnail-cache';
export const MAX_THUMBNAIL_DOWNLOADS = 4;

const VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;
const CACHE_FILE_PATTERN = /(?:^|\/)([a-zA-Z0-9_-]{11})\.jpg$/;

/** Null for ids that could escape the cache folder or never name a real video. */
export function thumbnailCachePath(cacheDir: string, videoId: string): string | null {
	return VIDEO_ID_PATTERN.test(videoId) ? `${cacheDir}/${videoId}.jpg` : null;
}

export function videoIdFromCachePath(path: string): string | null {
	return CACHE_FILE_PATTERN.exec(path)?.[1] ?? null;
}

/** Resolves true when the file was written; `isStale` turns true once the queue was reset under the job. */
export type ThumbnailJob = (videoId: string, isStale: () => boolean) => Promise<boolean>;

/**
 * Runs at most `limit` jobs at once, each id at most once per session: a success or a failure
 * both settle the id, so a broken thumbnail is not retried until `reset()`. Jobs running across
 * a reset finish as stale and report nothing, but keep their slot and their id until they settle,
 * so the limit and one-job-per-id hold however often the queue is reset.
 */
export class ThumbnailQueue {
	private readonly waiting = new Set<string>();
	/** Every unsettled job, whatever generation started it. */
	private readonly running = new Set<string>();
	private readonly active = new Set<string>();
	private readonly settled = new Set<string>();
	private generation = 0;

	constructor(
		private readonly run: ThumbnailJob,
		private readonly onSettled: (videoId: string, written: boolean) => void,
		readonly limit = MAX_THUMBNAIL_DOWNLOADS,
	) {}

	request(videoId: string): boolean {
		if (this.waiting.has(videoId) || this.active.has(videoId) || this.settled.has(videoId)) return false;
		this.waiting.add(videoId);
		this.pump();
		return true;
	}

	get activeCount(): number {
		return this.running.size;
	}

	get waitingCount(): number {
		return this.waiting.size;
	}

	reset(): void {
		this.generation++;
		this.waiting.clear();
		this.active.clear();
		this.settled.clear();
	}

	private pump(): void {
		for (const videoId of this.waiting) {
			if (this.running.size >= this.limit) return;
			if (this.running.has(videoId)) continue;
			this.waiting.delete(videoId);
			this.running.add(videoId);
			this.active.add(videoId);
			this.start(videoId);
		}
	}

	private start(videoId: string): void {
		const generation = this.generation;
		const isStale = () => generation !== this.generation;
		const finish = (written: boolean) => {
			this.running.delete(videoId);
			if (!isStale()) {
				this.active.delete(videoId);
				this.settled.add(videoId);
				this.onSettled(videoId, written);
			}
			this.pump();
		};
		let job: Promise<boolean>;
		try {
			job = this.run(videoId, isStale);
		} catch {
			job = Promise.resolve(false);
		}
		void job.then(finish, () => finish(false));
	}
}
