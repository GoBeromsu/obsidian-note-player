import { Component, normalizePath, parseYaml, TFile, TFolder, type App, type CachedMetadata } from 'obsidian';
import type { CompanionBaseFile } from '../domain/base-files';
import { VAULT_ROOT } from '../domain/config';
import { collectScopedFiles } from '../domain/music-scope';
import { uniqueName } from '../utils/dedupe';
import { hasType } from '../utils/frontmatter';
import type { MarkdownNoteSnapshot } from '../types/notes';
import type { YoutubePlaylistPropertyMapping } from '../types/settings';
import { resolveEmbeddedFile } from './embed-resolution';

export async function ensureFolder(app: App, folderPath: string): Promise<void> {
	let current = '';
	for (const segment of folderPath.split('/').filter(Boolean)) {
		current = current ? `${current}/${segment}` : segment;
		if (!app.vault.getAbstractFileByPath(current)) {
			await app.vault.createFolder(current);
		}
	}
}

export function getAvailablePath(app: App, folder: string, baseName: string): string {
	return normalizePath(`${folder}/${uniqueName(baseName, (name) => !!app.vault.getAbstractFileByPath(normalizePath(`${folder}/${name}.md`)))}.md`);
}

/** Waits for the initial cache entry of a newly created note. Edits use withMetadataSettled. */
export function waitForMetadata(app: App, file: TFile, timeoutMs = 2000): Promise<void> {
	if (app.metadataCache.getFileCache(file)?.frontmatter) return Promise.resolve();
	return nextMetadataChange(app, file, timeoutMs);
}

function nextMetadataChange(app: App, file: TFile, timeoutMs = 2000): Promise<void> {
	const { metadataCache } = app;
	const win = activeWindow;
	return new Promise((resolve) => {
		const done = () => {
			win.clearTimeout(timer);
			metadataCache.offref(ref);
			resolve();
		};
		const ref = metadataCache.on('changed', (changed) => {
			if (changed.path === file.path) done();
		});
		const timer = win.setTimeout(done, timeoutMs);
	});
}

export interface VaultWriteHost {
	readonly app: App;
	readonly owner: Component;
}

/** Edits only the given frontmatter keys; resolves once the metadata cache has re-parsed the note. */
export async function updateFrontmatter(host: VaultWriteHost, path: string, edit: (frontmatter: Record<string, unknown>) => void): Promise<void> {
	const { app } = host;
	const file = app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) {
		throw new Error(`File not found: ${path}`);
	}
	await withMetadataSettled(host, file, () => app.fileManager.processFrontMatter(file, edit));
}

/** Subscribe before editing; only a cache event for the final written bytes establishes settlement. */
export async function withMetadataSettled(host: VaultWriteHost, file: TFile, write: () => Promise<void>): Promise<CachedMetadata | undefined> {
	const { app, owner } = host;
	const scope = owner.addChild(new Component());
	const cancellation = new Error(`Metadata wait cancelled for ${file.path}.`);
	let cancelled = false;
	let cancel: () => void = () => {};
	scope.register(() => { cancelled = true; cancel(); });
	const win = activeWindow;
	let expected: string | undefined;
	let indexed: string | undefined;
	let indexedCache: CachedMetadata | undefined;
	let finish: () => void = () => {};
	let timer: number | undefined;
	scope.register(() => { if (timer !== undefined) win.clearTimeout(timer); });
	try {
		const before = await app.vault.read(file);
		if (cancelled) throw cancellation;
		scope.registerEvent(app.metadataCache.on('changed', (changed, data, cache) => {
			if (changed.path !== file.path) return;
			indexed = data;
			indexedCache = cache;
			if (expected !== undefined && data === expected) finish();
		}));
		await write();
		if (cancelled) throw cancellation;
		expected = await app.vault.read(file);
		if (cancelled) throw cancellation;
		if (indexed === expected) return indexedCache;
		if (expected === before) return;
		await new Promise<void>((resolve, reject) => {
			finish = resolve;
			cancel = () => reject(cancellation);
			timer = win.setTimeout(() => reject(new Error(`Metadata did not settle for ${file.path}. Run the converter again.`)), 2000);
		});
		return indexedCache;
	} finally {
		owner.removeChild(scope);
	}
}

export async function openNoteInTab(app: App, path: string): Promise<void> {
	const file = app.vault.getAbstractFileByPath(path);
	if (file instanceof TFile) {
		await app.workspace.getLeaf('tab').openFile(file);
	}
}

export async function writeBaseFiles(app: App, baseFiles: CompanionBaseFile[]): Promise<void> {
	for (const baseFile of baseFiles) {
		const filePath = normalizePath(baseFile.path);
		const existing = app.vault.getAbstractFileByPath(filePath);

		if (existing instanceof TFile) {
			await app.vault.modify(existing, baseFile.content);
			continue;
		}

		if (existing) {
			throw new Error(`Unable to write base file at ${filePath}`);
		}

		await ensureFolder(app, filePath.slice(0, Math.max(filePath.lastIndexOf('/'), 0)));
		await app.vault.create(filePath, baseFile.content);
	}
}

const isMarkdown = (file: unknown): file is TFile => file instanceof TFile && file.extension === 'md';

/** Selected folders include all descendants; backlink members can also come from outside that scope. */
export function collectMusicFiles(app: App, folders: string[], playlistNoteType?: string): TFile[] {
	const roots = folders
		.map((path) => path === VAULT_ROOT ? app.vault.getRoot() : app.vault.getFolderByPath(normalizePath(path)))
		.filter((folder): folder is TFolder => folder !== null)
		.map((folder) => ({ folder, isVaultRoot: folder.isRoot() }));
	const scoped = collectScopedFiles<TFolder, TFile>(roots, {
		children: (folder) => ({
			folders: folder.children.filter((child): child is TFolder => child instanceof TFolder),
			files: folder.children.filter(isMarkdown),
		}),
		linked: (file) => (app.metadataCache.getFileCache(file)?.frontmatterLinks ?? [])
			.map((link) => app.metadataCache.getFirstLinkpathDest(link.link, file.path))
			.filter(isMarkdown),
	});
	if (playlistNoteType === undefined) return scoped;
	const companions = new Set(scoped.filter((file) => {
		const cache = app.metadataCache.getFileCache(file);
		return hasType(cache?.frontmatter, playlistNoteType) && cache?.embeds?.some((embed) =>
			resolveEmbeddedFile(app, embed.link, file.path)?.extension === 'base');
	}).map((file) => file.path));
	const files = new Set(scoped);
	for (const [source, targets] of Object.entries(app.metadataCache.resolvedLinks)) {
		if (!Object.keys(targets).some((target) => companions.has(target))) continue;
		const file = app.vault.getFileByPath(source);
		if (isMarkdown(file)) files.add(file);
	}
	return [...files];
}

export function collectNoteSnapshots(app: App, folders: string[], mapping: YoutubePlaylistPropertyMapping): MarkdownNoteSnapshot[] {
	return collectMusicFiles(app, folders, mapping.playlistNoteType).map((file) => {
		const cache = app.metadataCache.getFileCache(file);
		const frontmatterLinks: Record<string, string[]> = {};
		for (const link of cache?.frontmatterLinks ?? []) {
			const target = app.metadataCache.getFirstLinkpathDest(link.link, file.path);
			const key = link.key.split('.')[0];
			if (target && key) (frontmatterLinks[key] ??= []).push(target.path);
		}
		const embeddedBases = (cache?.embeds ?? [])
			.map((embed) => resolveEmbeddedFile(app, embed.link, file.path))
			.filter((target): target is TFile => target !== null && target.extension === 'base')
			.map((target) => target.path);
		return {
			path: file.path,
			basename: file.basename,
			ctime: file.stat.ctime,
			mtime: file.stat.mtime,
			frontmatterLinks,
			embeddedBases,
			frontmatter: cache?.frontmatter,
		};
	});
}

export async function collectBaseConfigs(app: App, notes: MarkdownNoteSnapshot[], playlistNoteType: string): Promise<Map<string, unknown>> {
	const paths = new Set(notes.filter((note) => hasType(note.frontmatter, playlistNoteType)).flatMap((note) => note.embeddedBases));
	const configs = new Map<string, unknown>();
	for (const path of paths) {
		const file = app.vault.getFileByPath(path);
		if (file) configs.set(path, parseYaml(await app.vault.cachedRead(file)));
	}
	return configs;
}
