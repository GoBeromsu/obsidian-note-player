import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, type MetadataCache } from 'obsidian';
import { DEFAULT_SETTINGS } from '../src/domain/config';
import { NOTICE_CATALOG, renderNotice } from '../src/domain/notices';
import { convertPlaylistNotes } from '../src/services/playlist-migration-service';
import { updateFrontmatter } from '../src/services/vault-io';
import { settledMigrationMetadata } from '../src/services/migration-metadata';
import { observeTestMetadata } from './helpers/migration-lifecycle';
import * as noticeService from '../src/ui/notices';
import type { PlaylistMigrationPlan } from '../src/domain/playlist-migration';
import { notices, state } from './helpers/migration-obsidian';

const preview = vi.hoisted(() => ({
	plan: undefined as PlaylistMigrationPlan | undefined,
	finish: undefined as ((confirmed: boolean) => void) | undefined,
	opened: () => {},
}));
const observers: (() => void)[] = [];
vi.mock('obsidian', () => import('./helpers/migration-obsidian'));
vi.mock('../src/ui/views/MigrationPreviewModal', () => ({
	MigrationPreviewModal: class {
		constructor(_app: unknown, plan: PlaylistMigrationPlan, finish: (confirmed: boolean) => void) {
			preview.plan = plan;
			preview.finish = finish;
		}
		open() { preview.opened(); }
		showProgress() {}
		close() {}
	},
}));

function signal<T>() {
	let resolve: (value: T) => void = () => {};
	const promise = new Promise<T>((done) => { resolve = done; });
	return { promise, resolve };
}

async function fixture(resolved = true, lateObserver = false) {
	const app = new App();
	if (!lateObserver) observers.push(observeTestMetadata(app));
	await app.vault.create('Playlists/Mix.md', '---\n{"type":"music-playlist","songs":["[[Tracks/A]]"]}\n---\nOriginal body\n');
	await app.vault.create('Tracks/A.md', '---\n{"type":"music","playlists":["[[Other]]"]}\n---\nTrack body\n');
	if (resolved) state(app).resolve();
	if (lateObserver) observers.push(observeTestMetadata(app));
	return {
		app, settings: { ...DEFAULT_SETTINGS, playlistFolder: 'Playlists', legacyPlaylistTrackProperty: 'songs' },
		saveSettings: vi.fn(() => Promise.resolve()),
	};
}

async function run(host: Awaited<ReturnType<typeof fixture>>, beforeConfirm: () => void = () => {}) {
	const opened = signal<void>();
	preview.opened = () => opened.resolve();
	const done = convertPlaylistNotes(host);
	await Promise.race([opened.promise, done]);
	if (preview.finish) {
		beforeConfirm();
		preview.finish(true);
	}
	await done;
	preview.finish = undefined;
}

beforeEach(() => {
	notices.length = 0;
	preview.plan = undefined;
	preview.finish = undefined;
	vi.stubGlobal('activeWindow', { setTimeout, clearTimeout });
});

afterEach(() => {
	for (const dispose of observers.splice(0)) dispose();
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('migration gate regressions', () => {
	it('converts using only declared public metadata members', async () => {
		const host = await fixture();
		const fake = state(host.app);
		const metadata = host.app.metadataCache;
		const surface = {
			getFileCache: metadata.getFileCache,
			getFirstLinkpathDest: metadata.getFirstLinkpathDest,
			on: metadata.on,
			offref: metadata.offref,
		} satisfies Pick<MetadataCache, 'getFileCache' | 'getFirstLinkpathDest' | 'on' | 'offref'>;
		const privateReads: PropertyKey[] = [];
		Reflect.set(fake, 'metadataCache', new Proxy(surface, {
			get(target, property, receiver) {
				if (!Reflect.has(target, property)) {
					privateReads.push(property);
					throw new Error(`Non-public metadata member: ${String(property)}`);
				}
				return Reflect.get(target, property, receiver);
			},
		}));

		await run(host);

		expect(privateReads).toEqual([]);
		expect(fake.cache.get('Playlists/Mix.md')?.embeds.map((embed) => embed.link)).toEqual(['Playlists/Mix.base']);
		expect(notices.at(-1)).toBe(renderNotice(NOTICE_CATALOG.migration_complete.template, { playlists: 1, tracks: 1, missing: 0 }));
	});

	it('converts an already-indexed playlist when the observer attaches after initial resolution', async () => {
		const host = await fixture(true, true);
		const fake = state(host.app);
		fake.asyncIndexing = true;
		vi.useFakeTimers();
		vi.stubGlobal('activeWindow', { setTimeout, clearTimeout });

		const done = run(host);
		await vi.runAllTimersAsync();
		await done;

		expect(fake.cache.get('Playlists/Mix.md')?.embeds.map((embed) => embed.link)).toEqual(['Playlists/Mix.base']);
		expect(notices.at(-1)).toBe(renderNotice(NOTICE_CATALOG.migration_complete.template, { playlists: 1, tracks: 1, missing: 0 }));
		expect(fake.handlers.size).toBe(1);
		expect(fake.resolvedHandlers.size).toBe(0);
	});

	it.each([false, true])('never announces no-op for a stale archived embed after interruption=%s', async (interrupted) => {
		const host = await fixture();
		const fake = state(host.app);
		const note = host.app.vault.getFileByPath('Playlists/Mix.md');
		if (!note) throw new Error('Missing note');
		if (interrupted) {
			const write = host.app.fileManager.processFrontMatter.bind(host.app.fileManager);
			const fault = vi.spyOn(host.app.fileManager, 'processFrontMatter').mockImplementation(async (file, edit) => {
				await write(file, edit);
				if (file.path === note.path) {
					fake.pauseIndexing = true;
					await host.app.vault.process(file, (content) => content.replace('\n![[Playlists/Mix.base]]\n', ''));
					throw new Error('Post-archive interruption');
				}
			});
			await run(host);
			fault.mockRestore();
		} else {
			await run(host);
			fake.pauseIndexing = true;
			await host.app.vault.process(note, (content) => content.replace('\n![[Playlists/Mix.base]]\n', ''));
		}
		const before = new Map(fake.contents);
		notices.length = 0;
		const notice = vi.spyOn(noticeService, 'showNotice');
		vi.useFakeTimers();
		vi.stubGlobal('activeWindow', { setTimeout, clearTimeout });

		const retry = run(host);
		await vi.runAllTimersAsync();
		await retry;

		expect(notice).not.toHaveBeenCalledWith('migration_already_bases');
		expect(notice).toHaveBeenCalledWith('migration_failed', expect.objectContaining({ name: note.path }));
		expect(fake.contents).toEqual(before);
		expect(fake.handlers.size).toBe(1);
		expect(fake.resolvedHandlers.size).toBe(0);
		fake.pauseIndexing = false;
		fake.flush();
		await run(host);
		expect(fake.cache.get(note.path)?.embeds.map((embed) => embed.link)).toEqual(['Playlists/Mix.base']);
		expect(fake.cache.get(note.path)?.frontmatter.tracks_legacy).toEqual(['[[Tracks/A]]']);
		expect([...fake.files.keys()].filter((path) => path.endsWith('.base'))).toEqual(['Playlists/Mix.base']);
	});

	it('rechecks the planned version before announcing no-op after settings persistence', async () => {
		const host = await fixture();
		const fake = state(host.app);
		const note = host.app.vault.getFileByPath('Playlists/Mix.md');
		if (!note) throw new Error('Missing note');
		await run(host);
		host.settings.legacyPlaylistTrackProperty = 'songs';
		host.saveSettings.mockImplementationOnce(async () => {
			fake.pauseIndexing = true;
			await host.app.vault.process(note, (content) => content.replace('\n![[Playlists/Mix.base]]\n', ''));
		});
		const notice = vi.spyOn(noticeService, 'showNotice');

		await convertPlaylistNotes(host);

		expect(notice).not.toHaveBeenCalledWith('migration_already_bases');
		expect(notice).toHaveBeenCalledWith('migration_failed', expect.objectContaining({ name: note.path }));
	});

	it.each(['missing sections', 'out of bounds', 'section end', 'frontmatter value', 'frontmatter end', 'embed original', 'embed bounds'])('does not certify an inconsistent public cache after late attachment: %s', async (problem) => {
		const host = await fixture(true, true);
		const fake = state(host.app);
		const cache = fake.cache.get('Playlists/Mix.md');
		if (!cache?.frontmatterPosition) throw new Error('Missing fixture metadata');
		switch (problem) {
			case 'missing sections': cache.sections = []; break;
			case 'out of bounds': cache.sections = [{ type: 'paragraph', position: { start: { line: 0, col: 0, offset: -1 }, end: { line: 0, col: 0, offset: 99999 } } }]; break;
			case 'section end': cache.sections = [{ type: 'paragraph', position: { start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: 0, offset: 1 } } }]; break;
			case 'frontmatter value': cache.frontmatter = { ...cache.frontmatter, songs: [] }; break;
			case 'frontmatter end': cache.frontmatterPosition = { ...cache.frontmatterPosition, end: { ...cache.frontmatterPosition.end, offset: 1 } }; break;
			case 'embed original': cache.embeds = [{ link: 'Playlists/Mix.base', original: '![[Playlists/Mix.base]]', position: cache.frontmatterPosition }]; break;
			case 'embed bounds': cache.embeds = [{ link: 'Playlists/Mix.base', original: '![[Playlists/Mix.base]]', position: { start: { line: 0, col: 0, offset: -1 }, end: { line: 0, col: 0, offset: 1 } } }]; break;
		}
		const before = new Map(fake.contents);
		const notice = vi.spyOn(noticeService, 'showNotice');
		vi.useFakeTimers();
		vi.stubGlobal('activeWindow', { setTimeout, clearTimeout });

		const done = run(host);
		await vi.runAllTimersAsync();
		await done;

		expect(fake.contents).toEqual(before);
		expect(notice).not.toHaveBeenCalledWith('migration_already_bases');
		expect(notice).toHaveBeenCalledWith('migration_failed', expect.objectContaining({ name: 'Playlists/Mix.md' }));
	});

	it('bootstraps a consistent public cache without changing bytes, stats or emitting an indexing event', async () => {
		const host = await fixture(true, true);
		const fake = state(host.app);
		const note = host.app.vault.getFileByPath('Playlists/Mix.md');
		if (!note) throw new Error('Missing note');
		const before = new Map(fake.contents);
		const stat = { ...note.stat };
		const changed = vi.fn();
		const ref = host.app.metadataCache.on('changed', changed);
		const cachedRead = vi.spyOn(host.app.vault, 'cachedRead');

		try {
			const snapshot = await settledMigrationMetadata(host.app, note);
			expect(snapshot.cache).toBe(fake.cache.get(note.path));
			expect(cachedRead).toHaveBeenCalledWith(note);
			expect(fake.contents).toEqual(before);
			expect(note.stat).toEqual(stat);
			expect(changed).not.toHaveBeenCalled();
		} finally {
			host.app.metadataCache.offref(ref);
		}
	});

	it.each(['```md\n![[Bases/Example.base]]\n```', '`![[Bases/Example.base]]`'])(
		'does not pair with a code-only embed: %s', async (example) => {
			const host = await fixture();
			const fake = state(host.app);
			await host.app.vault.create('Bases/Example.base', 'views: []\n');
			const note = host.app.vault.getFileByPath('Playlists/Mix.md');
			if (!note) throw new Error('Missing note');
			await host.app.vault.process(note, (content) => `${content}\n${example}\n`);

			await run(host);

			expect(fake.contents.get(note.path)).toContain('\n![[Playlists/Mix.base]]\n');
			expect(fake.files.has('Playlists/Mix.base')).toBe(true);
		},
	);

	it('reuses its own base after repeated membership write interruptions', async () => {
		const host = await fixture();
		const write = host.app.fileManager.processFrontMatter.bind(host.app.fileManager);
		const broken = vi.spyOn(host.app.fileManager, 'processFrontMatter')
			.mockRejectedValueOnce(new Error('Write denied'))
			.mockRejectedValueOnce(new Error('Write denied'))
			.mockImplementation(write);

		await run(host);
		await run(host);
		await run(host);

		expect([...state(host.app).files.keys()].filter((path) => path.endsWith('.base'))).toEqual(['Playlists/Mix.base']);
		expect(state(host.app).contents.get('Playlists/Mix.md')).toContain('"tracks_legacy":');
		broken.mockRestore();
	});

	it.each(['```md\n![[Playlists/Mix.base]]\n```', '`![[Playlists/Mix.base]]`'])(
		'restores a removed real embed despite stale pairing metadata and code example: %s', async (example) => {
			const host = await fixture();
			const fake = state(host.app);
			const note = host.app.vault.getFileByPath('Playlists/Mix.md');
			if (!note) throw new Error('Missing note');
			await host.app.vault.create('Playlists/Mix.base', '# note-player migration for: "Playlists/Mix.md"\nviews: []\n');
			const original = await host.app.vault.read(note);
			await host.app.vault.process(note, () => `${original}\n![[Playlists/Mix.base]]\n`);
			fake.pauseIndexing = true;
			await host.app.vault.process(note, () => `${original}\n${example}\n`);
			fake.pauseIndexing = false;
			fake.onSubscribe = (name) => { if (name === 'resolved') fake.flush(); };

			await run(host);

			expect(fake.contents.get(note.path)?.split('\n').slice(3).join('\n')).toBe(
				`Original body\n\n${example}\n\n![[Playlists/Mix.base]]\n`,
			);
			expect(notices.at(-1)).toBe(renderNotice(NOTICE_CATALOG.migration_complete.template, { playlists: 1, tracks: 1, missing: 0 }));
		},
	);

	it('keeps exactly one embed across archive interruptions with delayed body indexing', async () => {
		const host = await fixture();
		const fake = state(host.app);
		fake.pauseIndexing = true;
		fake.onSubscribe = (name) => { if (name === 'resolved') fake.flush(); };
		fake.onWrite = (file) => {
			if (file.path === 'Playlists/Mix.md') fake.flush();
		};
		const write = host.app.fileManager.processFrontMatter.bind(host.app.fileManager);
		let interruptions = 2;
		vi.spyOn(host.app.fileManager, 'processFrontMatter').mockImplementation(async (file, edit) => {
			if (file.path === 'Playlists/Mix.md' && interruptions > 0) {
				interruptions--;
				throw new Error('Archive write denied');
			}
			await write(file, edit);
		});

		try {
			await run(host);
			await run(host);
			await run(host, () => { fake.pauseIndexing = false; });
		} finally {
			fake.pauseIndexing = false;
			fake.flush();
		}

		expect(fake.contents.get('Playlists/Mix.md')?.match(/!\[\[Playlists\/Mix\.base\]\]/g)).toEqual(['![[Playlists/Mix.base]]']);
		expect([...fake.files.keys()].filter((path) => path.endsWith('.base'))).toEqual(['Playlists/Mix.base']);
		expect(fake.contents.get('Playlists/Mix.md')).toContain('"tracks_legacy":');
		expect(notices.at(-1)).toBe(renderNotice(NOTICE_CATALOG.migration_complete.template, { playlists: 1, tracks: 0, missing: 0 }));
	});

	it.each([
		{ body: '> ~~~md\n> ![[Playlists/Mix.base]]\n> ~~~\n', embeds: [], append: true },
		{ body: '`example\n\n![[Playlists/Mix.base]]\n\n`end\n', embeds: ['Playlists/Mix.base'], append: false },
	])('uses native parsed embeds for Markdown block boundaries: $body', async ({ body, embeds, append }) => {
		const host = await fixture();
		const fake = state(host.app);
		const note = host.app.vault.getFileByPath('Playlists/Mix.md');
		if (!note) throw new Error('Missing note');
		await host.app.vault.create('Playlists/Mix.base', '# note-player migration for: "Playlists/Mix.md"\nviews: []\n');
		const header = '---\n{"type":"music-playlist","songs":["[[Tracks/A]]"]}\n---\n';
		await host.app.vault.process(note, () => `${header}![[Playlists/Mix.base]]\n`);
		// Canned native-parser results: the fake is an event source, not a Markdown oracle.
		fake.parsedBodies.set(body, embeds);
		fake.parsedBodies.set(`${body}\n![[Playlists/Mix.base]]\n`, [...embeds, 'Playlists/Mix.base']);
		fake.pauseIndexing = true;
		await host.app.vault.process(note, () => header + body);
		fake.pauseIndexing = false;
		fake.onSubscribe = (name) => { if (name === 'resolved') fake.flush(); };

		await run(host);

		const expectedBody = append ? `${body}\n![[Playlists/Mix.base]]\n` : body;
		expect(fake.contents.get(note.path)?.split('\n').slice(3).join('\n')).toBe(expectedBody);
		expect(notices.at(-1)).toBe(renderNotice(NOTICE_CATALOG.migration_complete.template, { playlists: 1, tracks: 1, missing: 0 }));
	});

	it('rejects a changed version inside the atomic callback without appending a duplicate', async () => {
		const host = await fixture();
		const fake = state(host.app);
		const process = host.app.vault.process.bind(host.app.vault);
		vi.spyOn(host.app.vault, 'process').mockImplementationOnce((file, edit) => {
			fake.contents.set(file.path, `${fake.contents.get(file.path)}\n![[Playlists/Mix.base]]\n`);
			return process(file, edit);
		});

		await run(host);

		expect(fake.contents.get('Playlists/Mix.md')?.match(/!\[\[Playlists\/Mix\.base\]\]/g)).toEqual(['![[Playlists/Mix.base]]']);
		expect(notices.at(-1)).toContain(renderNotice(NOTICE_CATALOG.migration_complete.template, { playlists: 0, tracks: 1, missing: 0 }));
	});

	it.each(['', '\n![[Playlists/Mix.base]]\n\n![[Playlists/Mix.base]]\n'])(
		'does not report success if the archive write leaves other than one parsed embed: %s', async (replacement) => {
		const host = await fixture();
		const fake = state(host.app);
		const write = host.app.fileManager.processFrontMatter.bind(host.app.fileManager);
		vi.spyOn(host.app.fileManager, 'processFrontMatter').mockImplementation(async (file, edit) => {
			await write(file, edit);
			if (file.path === 'Playlists/Mix.md') {
				await host.app.vault.process(file, (content) => content.replace('\n![[Playlists/Mix.base]]\n', replacement));
			}
		});
		const failed = vi.spyOn(noticeService, 'showNotice');

		await run(host);

		expect(fake.cache.get('Playlists/Mix.md')?.embeds).toHaveLength(replacement ? 2 : 0);
		expect(notices.at(-1)).toContain(renderNotice(NOTICE_CATALOG.migration_complete.template, { playlists: 0, tracks: 1, missing: 0 }));
		expect(failed).toHaveBeenCalledWith('migration_failed', expect.objectContaining({ name: 'Playlists/Mix.md' }));
	});

	it('converts another playlist and reports the result when previewed YAML becomes malformed', async () => {
		const host = await fixture();
		const fake = state(host.app);
		await host.app.vault.create('Playlists/Next.md', '---\n{"type":"music-playlist","songs":[]}\n---\nNext body\n');

		await run(host, () => fake.contents.set('Playlists/Mix.md', '---\n{"type":"music-playlist","songs":[}\n---\nOriginal body\n'));

		expect(fake.contents.get('Playlists/Next.md')).toContain('"tracks_legacy":[]');
		expect(host.settings.legacyPlaylistTrackProperty).toBe('songs');
		expect(notices.at(-1)).toContain(renderNotice(NOTICE_CATALOG.migration_complete.template, { playlists: 1, tracks: 0, missing: 0 }));
		expect(notices.at(-1)).toContain('Playlists/Mix.md');
	});

	it('does not announce completion while a legacy playlist has no metadata', async () => {
		const host = await fixture();
		const fake = state(host.app);
		const before = new Map(fake.contents);
		fake.cache.delete('Playlists/Mix.md');
		const notice = vi.spyOn(noticeService, 'showNotice');
		vi.useFakeTimers();
		vi.stubGlobal('activeWindow', { setTimeout, clearTimeout });

		const done = convertPlaylistNotes(host);
		await vi.runAllTimersAsync();
		await done;

		expect(notice).not.toHaveBeenCalledWith('migration_already_bases');
		expect(notice).toHaveBeenCalledWith('migration_failed', expect.objectContaining({ name: 'Playlists/Mix.md' }));
		expect(fake.contents.get('Playlists/Mix.md')).toContain('"songs":');
		expect(fake.contents).toEqual(before);
		notice.mockRestore();
	});

	it('waits for initial native resolution before making any conversion writes', async () => {
		const host = await fixture(false);
		const fake = state(host.app);
		const note = fake.files.get('Playlists/Mix.md');
		if (!note) throw new Error('Missing note');
		fake.cache.delete(note.path);
		let resolved = false;
		let prematureWrites = 0;
		fake.onWrite = () => { if (!resolved) prematureWrites++; };
		fake.onSubscribe = (name) => {
			if (name !== 'resolved' || resolved) return;
			fake.index(note, fake.contents.get(note.path) ?? '');
			resolved = true;
			fake.resolve();
		};

		await run(host);

		expect(resolved).toBe(true);
		expect(prematureWrites).toBe(0);
		expect(fake.cache.get(note.path)?.embeds.map((embed) => embed.link)).toEqual(['Playlists/Mix.base']);
		expect(notices.at(-1)).toBe(renderNotice(NOTICE_CATALOG.migration_complete.template, { playlists: 1, tracks: 1, missing: 0 }));
	});

	it.each(['', '\nEdited body\n'])('times out without writes when the indexed version lags a file edit, then recovers: %s', async (suffix) => {
		const host = await fixture();
		const fake = state(host.app);
		const note = host.app.vault.getFileByPath('Playlists/Mix.md');
		if (!note) throw new Error('Missing note');
		await settledMigrationMetadata(host.app, note);
		fake.pauseIndexing = true;
		await host.app.vault.process(note, (content) => content + suffix);
		const before = new Map(fake.contents);
		const baseline = fake.handlers.size;
		const notice = vi.spyOn(noticeService, 'showNotice');
		vi.useFakeTimers();
		vi.stubGlobal('activeWindow', { setTimeout, clearTimeout });

		const done = run(host);
		await vi.runAllTimersAsync();
		await done;

		expect(fake.contents).toEqual(before);
		expect(fake.handlers.size).toBe(baseline);
		expect(fake.resolvedHandlers.size).toBe(0);
		expect(notice).toHaveBeenCalledWith('migration_failed', expect.objectContaining({ name: note.path }));
		expect(notice).not.toHaveBeenCalledWith('migration_already_bases');
		fake.pauseIndexing = false;
		fake.flush();
		await run(host);
		expect(fake.cache.get(note.path)?.embeds.map((embed) => embed.link)).toEqual(['Playlists/Mix.base']);
	});

	it('keeps the indexed conversion pending until metadata acknowledges its write', async () => {
		const host = await fixture();
		const fake = state(host.app);
		const baseline = fake.handlers.size;
		fake.pauseIndexing = true;
		const boundary = signal<'subscribed' | 'completed'>();
		const written = signal<void>();
		fake.onSubscribe = () => boundary.resolve('subscribed');
		fake.onWrite = (file) => {
			if (file.path === 'Playlists/Mix.md' && !fake.contents.get(file.path)?.includes('"tracks_legacy":')) fake.flush();
			if (file.path === 'Playlists/Mix.md' && fake.contents.get(file.path)?.includes('"tracks_legacy":')) written.resolve();
		};
		const opened = signal<void>();
		preview.opened = () => opened.resolve();
		const done = convertPlaylistNotes(host);
		void done.then(() => boundary.resolve('completed'));
		await opened.promise;
		preview.finish?.(true);
		try {
			expect(await boundary.promise).toBe('subscribed');
			await written.promise;
		} finally {
			fake.pauseIndexing = false;
			fake.flush();
			await done;
		}
		expect(fake.handlers.size).toBe(baseline);
	});

	it('ignores a stale same-file event delivered before the frontmatter write finishes', async () => {
		const host = await fixture();
		const fake = state(host.app);
		const baseline = fake.handlers.size;
		fake.pauseIndexing = true;
		const file = host.app.vault.getFileByPath('Tracks/A.md');
		if (!file) throw new Error('Missing track');
		const before = await host.app.vault.read(file);
		const entered = signal<void>();
		const release = signal<void>();
		const written = signal<void>();
		fake.onWrite = () => written.resolve();
		const write = host.app.fileManager.processFrontMatter.bind(host.app.fileManager);
		vi.spyOn(host.app.fileManager, 'processFrontMatter').mockImplementationOnce(async (track, edit) => {
			entered.resolve();
			await release.promise;
			await write(track, edit);
		});
		const done = updateFrontmatter(host.app, file.path, (fm) => { fm.playlists = ['[[Playlists/Mix]]']; });
		await entered.promise;
		const indexedFile = fake.files.get(file.path);
		if (!indexedFile) throw new Error('Missing fake file');
		fake.index(indexedFile, before);
		try {
			expect(fake.handlers.size).toBe(baseline + 1);
		} finally {
			release.resolve();
			await written.promise;
			fake.flush();
			await done;
		}
		expect(fake.cache.get(file.path)?.frontmatter.playlists).toEqual(['[[Playlists/Mix]]']);
		expect(fake.handlers.size).toBe(baseline);
	});
});
