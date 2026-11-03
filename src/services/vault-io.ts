import { normalizePath, parseYaml, TFile, TFolder, type App, type CachedMetadata } from 'obsidian';
import type { CompanionBaseFile } from '../domain/base-files';
import { VAULT_ROOT } from '../domain/config';
import { collectScopedFiles } from '../domain/music-scope';
import { uniqueName } from '../utils/dedupe';
import { hasType } from '../utils/frontmatter';
import type { MarkdownNoteSnapshot } from '../types/notes';
import type { YoutubePlaylistPropertyMapping } from '../types/settings';

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

/** Resolves once the metadata cache has parsed a freshly written note, or after `timeoutMs`. */
export function waitForMetadata(app: App, file: TFile, timeoutMs = 2000): Promise<void> {
	if (app.metadataCache.getFileCache(file)?.frontmatter) return Promise.resolve();
	return nextMetadataChange(app, file, { timeoutMs });
}

function nextMetadataChange(app: App, file: TFile, options: {
	timeoutMs?: number;
	matches?: (cache: CachedMetadata) => boolean;
} = {}): Promise<void> {
	const { metadataCache } = app;
	const win = activeWindow;
	return new Promise((resolve) => {
		const done = () => {
			win.clearTimeout(timer);
			metadataCache.offref(ref);
			resolve();
		};
		const ref = metadataCache.on('changed', (changed, _data, cache) => {
			if (changed.path === file.path && (!options.matches || options.matches(cache))) done();
		});
		const timer = win.setTimeout(done, options.timeoutMs ?? 2000);
	});
}

/** Edits only the given frontmatter keys; resolves once the metadata cache has re-parsed the note. */
export async function updateFrontmatter(app: App, path: string, edit: (frontmatter: Record<string, unknown>) => void): Promise<void> {
	const file = app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) {
		throw new Error(`File not found: ${path}`);
	}
	let expected: Record<string, unknown> | null = null;
	const parsed = nextMetadataChange(app, file, {
		matches: (cache) => expected !== null && Object.entries(expected)
			.every(([key, value]) => JSON.stringify(cache.frontmatter?.[key]) === JSON.stringify(value)),
	});
	let changed = false;
	await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
		const before = JSON.stringify(frontmatter);
		edit(frontmatter);
		expected = { ...frontmatter };
		changed = JSON.stringify(frontmatter) !== before;
	});
	if (changed) await parsed;
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

/** Root scope is shallow; backlink members are included without scanning the vault. */
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
			app.metadataCache.getFirstLinkpathDest(embed.link, file.path)?.extension === 'base');
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
			.map((embed) => app.metadataCache.getFirstLinkpathDest(embed.link, file.path))
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
