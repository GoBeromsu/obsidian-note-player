import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian';
import { DEFAULT_SETTINGS } from '../src/domain/config';
import { convertPlaylistNotes } from '../src/services/playlist-migration-service';
import type { PlaylistMigrationPlan } from '../src/domain/playlist-migration';

const preview = vi.hoisted(() => ({
	plan: undefined as PlaylistMigrationPlan | undefined,
	finish: undefined as ((confirmed: boolean) => void) | undefined,
	opened: () => {},
}));

vi.mock('../src/ui/views/MigrationPreviewModal', () => ({
	MigrationPreviewModal: class {
		constructor(_app: unknown, plan: PlaylistMigrationPlan, finish: (confirmed: boolean) => void) {
			preview.plan = plan;
			preview.finish = finish;
		}
		open() { preview.opened(); }
	},
}));

vi.mock('obsidian', () => {
	const frontmatter = (content: string): Record<string, unknown> => JSON.parse(content.split('\n')[1] ?? '{}');
	const body = (content: string) => content.split('\n').slice(3).join('\n');
	class File {
		extension: string;
		basename: string;
		parent: { path: string };
		constructor(readonly path: string) {
			this.extension = path.split('.').at(-1) ?? '';
			this.basename = path.split('/').at(-1)?.replace(/\.[^.]+$/, '') ?? '';
			this.parent = { path: path.split('/').slice(0, -1).join('/') };
		}
	}
	class App {
		files = new Map<string, File>();
		contents = new Map<string, string>();
		staleCache = new Map<string, Record<string, unknown>>();
		failPath = '';
		vault = {
			getMarkdownFiles: () => [...this.files.values()].filter((file) => file.extension === 'md'),
			getAllLoadedFiles: () => [...this.files.values()],
			getFileByPath: (path: string) => this.files.get(path) ?? null,
			read: (file: File) => Promise.resolve(this.contents.get(file.path) ?? ''),
			create: (path: string, content: string) => {
				if (this.files.has(path)) return Promise.reject(new Error('File exists'));
				const file = new File(path);
				this.files.set(path, file);
				this.contents.set(path, content);
				return Promise.resolve(file);
			},
			process: (file: File, edit: (content: string) => string) => {
				const content = edit(this.contents.get(file.path) ?? '');
				this.contents.set(file.path, content);
				return Promise.resolve(content);
			},
		};
		metadataCache = {
			getFileCache: (file: File) => ({
				frontmatter: this.staleCache.get(file.path) ?? frontmatter(this.contents.get(file.path) ?? ''),
				embeds: [],
			}),
			getFirstLinkpathDest: (link: string) => {
				const path = link.replace(/\.md$/, '');
				return this.files.get(link) ?? this.files.get(`${path}.md`) ?? null;
			},
		};
		fileManager = {
			processFrontMatter: (file: File, edit: (fm: Record<string, unknown>) => void) => {
				if (file.path === this.failPath) return Promise.reject(new Error('Write denied'));
				const content = this.contents.get(file.path) ?? '';
				const fm = frontmatter(content);
				edit(fm);
				this.contents.set(file.path, `---\n${JSON.stringify(fm)}\n---\n${body(content)}`);
				return Promise.resolve();
			},
		};
	}
	return {
		App, TFile: File, Notice: class { setMessage() {} hide() {} },
		getFrontMatterInfo: (content: string) => ({
			exists: content.startsWith('---\n'), frontmatter: content.split('\n')[1] ?? '{}',
			contentStart: content.indexOf('\n---\n') + 5,
		}),
		parseYaml: (value: string) => JSON.parse(value),
	};
});

function seed(app: App, path: string, fm: Record<string, unknown>) {
	return app.vault.create(path, `---\n${JSON.stringify(fm)}\n---\nOriginal body\n`);
}

function readNote(app: App, path: string): Promise<string> {
	const file = app.vault.getFileByPath(path);
	if (!file) throw new Error(`Missing fixture: ${path}`);
	return app.vault.read(file);
}

async function fixture(legacyKey = 'songs') {
	const app = new App();
	await seed(app, 'Playlists/Mix.md', { type: 'music-playlist', [legacyKey]: ['[[Tracks/A]]', '[[Missing]]'] });
	await seed(app, 'Tracks/A.md', { type: 'music', playlists: ['[[Other]]'] });
	return {
		app,
		settings: { ...DEFAULT_SETTINGS, playlistFolder: 'Playlists', legacyPlaylistTrackProperty: legacyKey },
		saveSettings: vi.fn(() => Promise.resolve()),
	};
}

async function openPreview(host: Awaited<ReturnType<typeof fixture>>) {
	let ready: () => void = () => {};
	const opened = new Promise<void>((resolve) => { ready = resolve; });
	preview.opened = ready;
	const done = convertPlaylistNotes(host);
	await opened;
	return { done };
}

beforeEach(() => {
	preview.plan = undefined;
	preview.finish = undefined;
});

describe('playlist migration service', () => {
	it('preserves the archive and body while linking resolved tracks and keeping unknown memberships', async () => {
		const host = await fixture();
		const { done } = await openPreview(host);

		preview.finish?.(true);
		await done;

		expect(await readNote(host.app, 'Playlists/Mix.md')).toBe(
			'---\n{"type":"music-playlist","tracks_legacy":["[[Tracks/A]]","[[Missing]]"]}\n---\nOriginal body\n\n![[Playlists/Mix.base]]\n',
		);
		expect(await readNote(host.app, 'Tracks/A.md')).toContain(
			'"playlists":["[[Other]]","[[Playlists/Mix]]"]',
		);
		expect(host.app.vault.getFileByPath('Playlists/Mix.base')).not.toBeNull();
		expect(host.settings.legacyPlaylistTrackProperty).toBeUndefined();
	});

	it('holds one preview for overlapping invocations and performs no writes on cancel', async () => {
		const host = await fixture();
		const { done } = await openPreview(host);
		const before = await readNote(host.app, 'Playlists/Mix.md');

		const duplicate = convertPlaylistNotes(host);
		preview.finish?.(false);
		await done;

		expect(duplicate).toBe(done);
		expect(await readNote(host.app, 'Playlists/Mix.md')).toBe(before);
		expect(host.app.vault.getAllLoadedFiles().map((file) => file.path)).toEqual(['Playlists/Mix.md', 'Tracks/A.md']);
	});

	it('skips conflicts and invalid notes without forgetting their configured legacy key', async () => {
		const host = await fixture();
		await seed(host.app, 'Playlists/Conflict.md', { type: 'music-playlist', songs: [], tracks_legacy: ['keep'] });
		await seed(host.app, 'Playlists/Invalid.md', { type: 'music-playlist', songs: 'not a list' });
		const conflict = await readNote(host.app, 'Playlists/Conflict.md');
		const { done } = await openPreview(host);
		expect(preview.plan).toMatchObject({ conflicts: ['Playlists/Conflict.md'], invalid: ['Playlists/Invalid.md'] });

		preview.finish?.(true);
		await done;

		expect(await readNote(host.app, 'Playlists/Conflict.md')).toBe(conflict);
		expect(host.settings.legacyPlaylistTrackProperty).toBe('songs');
	});

	it('continues with later playlists after one track write fails', async () => {
		const host = await fixture();
		await seed(host.app, 'Playlists/Next.md', { type: 'music-playlist', songs: [] });
		vi.spyOn(host.app.fileManager, 'processFrontMatter').mockImplementationOnce(() => Promise.reject(new Error('Write denied')));
		const { done } = await openPreview(host);

		preview.finish?.(true);
		await done;

		expect(await readNote(host.app, 'Playlists/Mix.md')).toContain('"songs":');
		expect(await readNote(host.app, 'Playlists/Next.md')).toContain('"tracks_legacy":[]');
		expect(host.settings.legacyPlaylistTrackProperty).toBe('songs');
	});

	it('does not duplicate bases or memberships when metadata still contains the legacy state', async () => {
		const host = await fixture('tracks');
		const stale = { type: 'music-playlist', tracks: ['[[Tracks/A]]', '[[Missing]]'] };
		vi.spyOn(host.app.metadataCache, 'getFileCache').mockReturnValue({ frontmatter: stale });
		const { done } = await openPreview(host);
		preview.finish?.(true);
		await done;
		const paths = host.app.vault.getAllLoadedFiles().map((file) => file.path);
		const note = await readNote(host.app, 'Playlists/Mix.md');
		const track = await readNote(host.app, 'Tracks/A.md');

		await convertPlaylistNotes(host);

		expect(host.app.vault.getAllLoadedFiles().map((file) => file.path)).toEqual(paths);
		expect(await readNote(host.app, 'Playlists/Mix.md')).toBe(note);
		expect(await readNote(host.app, 'Tracks/A.md')).toBe(track);
	});
});
