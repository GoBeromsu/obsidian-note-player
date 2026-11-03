import type { App, CachedMetadata, TFile } from 'obsidian';

interface IndexedVersion {
	readonly mtime: number;
	readonly size: number;
	readonly cache: CachedMetadata;
	readonly data: string;
}

const states = new WeakMap<App, WeakMap<TFile, IndexedVersion>>();

/** CachedMetadata has no public version stamp; record native parser events instead. */
export function observeMigrationMetadata(app: App): () => void {
	const versions = new WeakMap<TFile, IndexedVersion>();
	states.set(app, versions);
	const changed = app.metadataCache.on('changed', (file, data, cache) => {
		versions.set(file, { mtime: file.stat.mtime, size: file.stat.size, cache, data });
	});
	return () => {
		app.metadataCache.offref(changed);
		states.delete(app);
	};
}

export function settledMigrationMetadata(app: App, file: TFile): Promise<IndexedVersion> {
	const versions = states.get(app);
	if (!versions) return Promise.reject(new Error('Metadata is not ready. Wait for indexing and run the converter again.'));
	const win = activeWindow;
	return new Promise((resolve, reject) => {
		let active = true;
		const check = async () => {
			try {
				const { mtime, size } = file.stat;
				const data = await app.vault.read(file);
				if (!active || file.stat.mtime !== mtime || file.stat.size !== size) return;
				const cache = app.metadataCache.getFileCache(file);
				if (!cache) return;
				const indexed = versions.get(file);
				const matches = indexed?.mtime === mtime && indexed.size === size && indexed.cache === cache && indexed.data === data;
				// Native getFileCache uses fileCache[path].hash; its stamp survives late observer attachment.
				// This field is not public API: an unknown format must never certify a cached snapshot.
				const fileCache: unknown = Reflect.get(app.metadataCache, 'fileCache');
				const native: unknown = fileCache && typeof fileCache === 'object' ? Reflect.get(fileCache, file.path) : null;
				const nativeMatches = native && typeof native === 'object'
					&& Reflect.get(native, 'mtime') === mtime && Reflect.get(native, 'size') === size;
				if (!matches && !nativeMatches) return;
				const version = { mtime, size, cache, data };
				versions.set(file, version);
				finish();
				resolve(version);
			} catch (error: unknown) {
				finish();
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		};
		const changed = app.metadataCache.on('changed', (changedFile) => {
			if (changedFile.path === file.path) void check();
		});
		const resolved = app.metadataCache.on('resolved', () => { void check(); });
		const timer = win.setTimeout(() => {
			finish();
			reject(new Error(`Metadata is not ready for ${file.path}. Wait for indexing and run the converter again.`));
		}, 2000);
		function finish() {
			active = false;
			win.clearTimeout(timer);
			app.metadataCache.offref(changed);
			app.metadataCache.offref(resolved);
		}
		void check();
	});
}
