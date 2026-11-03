import { TFile, type App, type CachedMetadata } from 'obsidian';

interface IndexedVersion {
	readonly mtime: number;
	readonly size: number;
	readonly cache: CachedMetadata;
	readonly data: string;
}

interface MetadataState {
	versions: WeakMap<TFile, IndexedVersion>;
	dirty: WeakSet<TFile>;
	resolved: boolean;
}

const states = new WeakMap<App, MetadataState>();

/** CachedMetadata has no public version stamp; record native parser events instead. */
export function observeMigrationMetadata(app: App): () => void {
	const state: MetadataState = { versions: new WeakMap(), dirty: new WeakSet(), resolved: false };
	states.set(app, state);
	const changed = app.metadataCache.on('changed', (file, data, cache) => {
		state.versions.set(file, { mtime: file.stat.mtime, size: file.stat.size, cache, data });
	});
	const modified = app.vault.on('modify', (file) => {
		if (file instanceof TFile) state.dirty.add(file);
	});
	const resolved = app.metadataCache.on('resolved', () => {
		state.resolved = true;
		state.versions = new WeakMap();
		state.dirty = new WeakSet();
	});
	return () => {
		app.metadataCache.offref(changed);
		app.metadataCache.offref(resolved);
		app.vault.offref(modified);
		states.delete(app);
	};
}

export function settledMigrationMetadata(app: App, file: TFile): Promise<IndexedVersion> {
	const state = states.get(app);
	if (!state) return Promise.reject(new Error('Metadata is not ready. Wait for indexing and run the converter again.'));
	const win = activeWindow;
	return new Promise((resolve, reject) => {
		let active = true;
		const check = async () => {
			try {
				const { mtime, size } = file.stat;
				const data = await app.vault.read(file);
				if (!active || !state.resolved || file.stat.mtime !== mtime || file.stat.size !== size) return;
				const cache = app.metadataCache.getFileCache(file);
				if (!cache) return;
				const indexed = state.versions.get(file);
				const matches = indexed?.mtime === mtime && indexed.size === size && indexed.cache === cache && indexed.data === data;
				if (!matches && (indexed || state.dirty.has(file))) return;
				const version = { mtime, size, cache, data };
				state.versions.set(file, version);
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
