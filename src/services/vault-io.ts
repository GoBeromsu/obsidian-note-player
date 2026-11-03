import { normalizePath, TFile, TFolder, type App } from 'obsidian';
import type { CompanionBaseFile } from '../domain/base-files';
import { collectScopedFiles } from '../domain/music-scope';
import { uniqueName } from '../utils/dedupe';
import type { MarkdownNoteSnapshot } from '../types/notes';

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
		const ref = metadataCache.on('changed', (changed) => { if (changed.path === file.path) done(); });
		const timer = win.setTimeout(done, timeoutMs);
	});
}

/** Edits only the given frontmatter keys; resolves once the metadata cache has re-parsed the note. */
export async function updateFrontmatter(app: App, path: string, edit: (frontmatter: Record<string, unknown>) => void): Promise<void> {
	const file = app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) {
		throw new Error(`File not found: ${path}`);
	}
	const parsed = nextMetadataChange(app, file);
	let changed = false;
	await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
		const before = JSON.stringify(frontmatter);
		edit(frontmatter);
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

/** Notes in the given folders plus the notes they link to in frontmatter. Empty folder = Obsidian's new-note location. */
export function collectMusicFiles(app: App, folders: string[]): TFile[] {
	const roots = folders
		.map((path) => app.vault.getFolderByPath(normalizePath(path || app.fileManager.getNewFileParent('').path)))
		.filter((folder): folder is TFolder => folder !== null)
		.map((folder) => ({ folder, isVaultRoot: folder.isRoot() }));
	return collectScopedFiles<TFolder, TFile>(roots, {
		children: (folder) => ({
			folders: folder.children.filter((child): child is TFolder => child instanceof TFolder),
			files: folder.children.filter(isMarkdown),
		}),
		linked: (file) => (app.metadataCache.getFileCache(file)?.frontmatterLinks ?? [])
			.map((link) => app.metadataCache.getFirstLinkpathDest(link.link, file.path))
			.filter(isMarkdown),
	});
}

export function collectNoteSnapshots(app: App, folders: string[]): MarkdownNoteSnapshot[] {
	return collectMusicFiles(app, folders).map((file) => ({
		path: file.path,
		basename: file.basename,
		ctime: file.stat.ctime,
		mtime: file.stat.mtime,
		frontmatterLinks: {},
		embeddedBases: [],
		frontmatter: app.metadataCache.getFileCache(file)?.frontmatter,
	}));
}
