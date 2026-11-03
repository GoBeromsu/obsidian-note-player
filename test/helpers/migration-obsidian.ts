type Cache = { frontmatter: Record<string, unknown>; embeds: { link: string; original: string }[] };
type Changed = (file: TFile, data: string, cache: Cache) => void;

const frontmatter = (content: string): Record<string, unknown> => JSON.parse(content.split('\n')[1] ?? '{}');
const body = (content: string) => content.split('\n').slice(3).join('\n');

export class TFile {
	readonly extension: string;
	readonly basename: string;
	readonly parent: { path: string };
	readonly stat = { ctime: 0, mtime: 0, size: 0 };
	constructor(readonly path: string) {
		this.extension = path.split('.').at(-1) ?? '';
		this.basename = path.split('/').at(-1)?.replace(/\.[^.]+$/, '') ?? '';
		this.parent = { path: path.split('/').slice(0, -1).join('/') };
	}
}

function cacheFor(content: string): Cache {
	const embeds: Cache['embeds'] = [];
	let fenced = false;
	for (const line of body(content).split('\n')) {
		if (line.startsWith('```') || line.startsWith('~~~')) {
			fenced = !fenced;
			continue;
		}
		if (fenced) continue;
		for (const [index, part] of line.split('`').entries()) {
			if (index % 2) continue;
			for (const match of part.matchAll(/!\[\[([^\]]+)\]\]/g)) {
				embeds.push({ link: match[1] ?? '', original: match[0] });
			}
		}
	}
	return { frontmatter: frontmatter(content), embeds };
}

export const notices: string[] = [];
export class Notice {
	constructor(message: string = '') { if (message) notices.push(message); }
	setMessage() {}
	hide() {}
}

const apps = new WeakMap<object, App>();
export function state(app: object): App {
	const value = apps.get(app);
	if (!value) throw new Error('Missing fake app');
	return value;
}

export class App {
	readonly files = new Map<string, TFile>();
	readonly contents = new Map<string, string>();
	readonly cache = new Map<string, Cache>();
	readonly parsedBodies = new Map<string, readonly string[]>();
	readonly handlers = new Set<Changed>();
	readonly resolvedHandlers = new Set<() => void>();
	readonly modifyHandlers = new Set<(file: TFile) => void>();
	readonly pending: { file: TFile; data: string }[] = [];
	pauseIndexing = false;
	onWrite: (file: TFile) => void = () => {};
	onSubscribe: (name: string) => void = () => {};
	constructor() { apps.set(this, this); }

	index(file: TFile, data: string): void {
		if (file.extension !== 'md') return;
		const cache = cacheFor(data);
		const parsed = this.parsedBodies.get(body(data));
		if (parsed) cache.embeds = parsed.map((link) => ({ link, original: `![[${link}]]` }));
		this.cache.set(file.path, cache);
		for (const handler of this.handlers) handler(file, data, cache);
	}

	flush(): void {
		for (const { file, data } of this.pending.splice(0)) this.index(file, data);
	}

	resolve(): void {
		this.flush();
		for (const handler of this.resolvedHandlers) handler();
	}

	private write(file: TFile, data: string): void {
		this.contents.set(file.path, data);
		file.stat.mtime++;
		file.stat.size = data.length;
		for (const handler of this.modifyHandlers) handler(file);
		if (this.pauseIndexing) this.pending.push({ file, data });
		else this.index(file, data);
		this.onWrite(file);
	}

	readonly vault = {
		on: (_name: 'modify', callback: (file: TFile) => void) => {
			this.modifyHandlers.add(callback);
			return { callback };
		},
		offref: (ref: { callback: (file: TFile) => void }) => { this.modifyHandlers.delete(ref.callback); },
		getMarkdownFiles: () => [...this.files.values()].filter((file) => file.extension === 'md'),
		getAllLoadedFiles: () => [...this.files.values()],
		getFileByPath: (path: string) => this.files.get(path) ?? null,
		getAbstractFileByPath: (path: string) => this.files.get(path) ?? null,
		read: (file: TFile) => Promise.resolve(this.contents.get(file.path) ?? ''),
		create: (path: string, content: string) => {
			if (this.files.has(path)) return Promise.reject(new Error('File exists'));
			const file = new TFile(path);
			this.files.set(path, file);
			this.write(file, content);
			return Promise.resolve(file);
		},
		process: (file: TFile, edit: (content: string) => string) => {
			const content = edit(this.contents.get(file.path) ?? '');
			this.write(file, content);
			return Promise.resolve(content);
		},
	};

	readonly metadataCache = {
		getFileCache: (file: TFile) => this.cache.get(file.path) ?? null,
		getFirstLinkpathDest: (link: string) => {
			const path = link.replace(/\.md$/, '');
			return this.files.get(link) ?? this.files.get(`${path}.md`) ?? null;
		},
		on: (...[name, callback]: ['changed', Changed] | ['resolved', () => void]) => {
			if (name === 'changed') this.handlers.add(callback);
			else this.resolvedHandlers.add(callback);
			this.onSubscribe(name);
			return { callback };
		},
		offref: (ref: { callback: Changed | (() => void) }) => {
			for (const handler of this.handlers) if (handler === ref.callback) this.handlers.delete(handler);
			for (const handler of this.resolvedHandlers) if (handler === ref.callback) this.resolvedHandlers.delete(handler);
		},
	};

	readonly fileManager = {
		processFrontMatter: (file: TFile, edit: (fm: Record<string, unknown>) => void) => {
			const content = this.contents.get(file.path) ?? '';
			const fm = frontmatter(content);
			edit(fm);
			this.write(file, `---\n${JSON.stringify(fm)}\n---\n${body(content)}`);
			return Promise.resolve();
		},
	};
}

export const getFrontMatterInfo = (content: string) => ({
	exists: content.startsWith('---\n'), frontmatter: content.split('\n')[1] ?? '{}',
	contentStart: content.indexOf('\n---\n') + 5,
});
export const parseYaml = (value: string): unknown => JSON.parse(value);
