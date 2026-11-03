import { getFrontMatterInfo, parseYaml, type App, type CachedMetadata, type Component, type Pos, type TFile } from 'obsidian';

interface IndexedVersion {
	readonly mtime: number;
	readonly size: number;
	readonly cache: CachedMetadata;
	readonly data: string;
}

const states = new WeakMap<App, Map<string, IndexedVersion>>();

function sameValue(left: unknown, right: unknown): boolean {
	if (left === right) return true;
	if (Array.isArray(left) || Array.isArray(right)) {
		return Array.isArray(left) && Array.isArray(right) && left.length === right.length
			&& left.every((value, index) => sameValue(value, right[index]));
	}
	if (left instanceof Date || right instanceof Date) {
		return left instanceof Date && right instanceof Date && left.getTime() === right.getTime();
	}
	if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
	const entries = Object.entries(left);
	const other = new Map(Object.entries(right));
	return entries.length === other.size && entries.every(([key, value]) => other.has(key) && sameValue(value, other.get(key)));
}

function cacheDescribesContent(cache: CachedMetadata, data: string): boolean {
	const within = (position: Pos) => Number.isInteger(position.start.offset) && Number.isInteger(position.end.offset)
		&& position.start.offset >= 0 && position.end.offset >= position.start.offset && position.end.offset <= data.length;
	if ((cache.embeds ?? []).some((embed) => !within(embed.position)
		|| data.slice(embed.position.start.offset, embed.position.end.offset) !== embed.original)) return false;
	const sections = cache.sections ?? [];
	if (sections.some((section) => !within(section.position))) return false;
	const end = sections.at(-1)?.position.end.offset ?? 0;
	if (end !== data.length && end !== data.trimEnd().length) return false;
	const info = getFrontMatterInfo(data);
	const position = cache.frontmatterPosition;
	if (!info.exists) return !position && !cache.frontmatter;
	if (!position || !within(position) || position.start.offset !== data.indexOf('---')
		|| position.end.offset !== data.slice(0, info.contentStart).trimEnd().length) return false;
	const block = getFrontMatterInfo(data.slice(position.start.offset, position.end.offset) + '\n');
	if (!block.exists || block.frontmatter !== info.frontmatter) return false;
	let parsed: unknown;
	try {
		parsed = parseYaml(info.frontmatter);
	} catch (error: unknown) {
		if (error instanceof Error) return false;
		throw error;
	}
	const cached = Object.fromEntries(Object.entries(cache.frontmatter ?? {}).filter(([key]) =>
		key !== 'position' || parsed && typeof parsed === 'object' && Object.hasOwn(parsed, key)));
	return sameValue(parsed ?? {}, cached);
}

/** CachedMetadata has no public version stamp; record native parser events instead. */
export function observeMigrationMetadata(app: App, owner: Pick<Component, 'registerEvent' | 'register'>): void {
	const versions = new Map<string, IndexedVersion>();
	states.set(app, versions);
	owner.registerEvent(app.metadataCache.on('changed', (file, data, cache) => {
		versions.set(file.path, { mtime: file.stat.mtime, size: file.stat.size, cache, data });
	}));
	owner.register(() => {
		states.delete(app);
	});
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
				const indexed = versions.get(file.path);
				const matches = indexed?.mtime === mtime && indexed.size === size && indexed.cache === cache && indexed.data === data;
				if (!matches) {
					if (indexed) return;
					const cached = await app.vault.cachedRead(file);
					if (!active || cached !== data || file.stat.mtime !== mtime || file.stat.size !== size
						|| app.metadataCache.getFileCache(file) !== cache || !cacheDescribesContent(cache, cached)) return;
				}
				const version = { mtime, size, cache, data };
				versions.set(file.path, version);
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
