import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, Component } from 'obsidian';
import { DEFAULT_SETTINGS } from '../src/domain/config';
import { NOTICE_CATALOG, renderNotice } from '../src/domain/notices';
import { migrationEmbedBlock } from '../src/domain/migration-embeds';
import { convertPlaylistNotes } from '../src/services/playlist-migration-service';
import * as noticeService from '../src/ui/notices';
import type { PlaylistMigrationPlan } from '../src/domain/playlist-migration';
import { notices, state } from './helpers/migration-obsidian';

const preview = vi.hoisted(() => ({
	plan: undefined as PlaylistMigrationPlan | undefined,
	finish: undefined as ((confirmed: boolean) => void) | undefined,
	opened: () => {},
}));
const owners: Component[] = [];
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

function signal() {
	let resolve: () => void = () => {};
	const promise = new Promise<void>((done) => { resolve = done; });
	return { promise, resolve };
}

const notePath = 'Playlists/Mix.md';
const basePath = 'Playlists/Mix.base';
const header = '---\n{"type":"music-playlist","songs":["[[Tracks/A]]"]}\n---\n';
const archived = '---\n{"type":"music-playlist","tracks_legacy":[]}\n---\n';
const complete = (playlists = 1, tracks = 1) =>
	renderNotice(NOTICE_CATALOG.migration_complete.template, { playlists, tracks, missing: 0 });

async function fixture() {
	const app = new App();
	await app.vault.create(notePath, header + 'Original body\n');
	await app.vault.create('Tracks/A.md', '---\n{"type":"music","playlists":["[[Other]]"]}\n---\nTrack body\n');
	state(app).resolve();
	const owner = new Component();
	owner.load();
	owners.push(owner);
	return Object.assign(owner, {
		app, settings: { ...DEFAULT_SETTINGS, playlistFolder: 'Playlists', legacyPlaylistTrackProperty: 'songs' },
		saveSettings: vi.fn(() => Promise.resolve()),
	});
}

async function run(host: Awaited<ReturnType<typeof fixture>>, beforeConfirm: () => void = () => {}) {
	const opened = signal();
	preview.opened = opened.resolve;
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
	for (const owner of owners.splice(0)) owner.unload();
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('migration gate regressions', () => {
	it.each(['Templates/meeting.template.md', 'Playlists/meeting.template.md'])(
		'reports already Bases on rerun with unrelated malformed YAML: %s', async (path) => {
			const host = await fixture();
			await run(host);
			host.settings.legacyPlaylistTrackProperty = 'songs';
			await host.app.vault.create(path, '---\n{"type":"template"}\n---\n');
			state(host.app).contents.set(path, '---\ntype: template\nparticipants:\n{{participants_yaml}}\n---\n');
			notices.length = 0;

			await run(host);

			expect(notices).toEqual([NOTICE_CATALOG.migration_already_bases.template]);
			expect(host.settings.legacyPlaylistTrackProperty).toBe('songs');
		},
	);

	it.each(['Templates/meeting.template.md', 'Playlists/meeting.template.md'])(
		'completes conversion without unrelated malformed YAML errors: %s', async (path) => {
			const host = await fixture();
			await host.app.vault.create(path, '---\n{"type":"template"}\n---\n');
			state(host.app).contents.set(path, '---\ntype: template\nparticipants:\n{{participants_yaml}}\n---\n');

			await run(host);

			expect(notices).toEqual([complete()]);
			expect(state(host.app).contents.get(notePath)).toContain(migrationEmbedBlock(basePath));
			expect(host.settings.legacyPlaylistTrackProperty).toBe('songs');
		},
	);

	it('reports malformed legacy candidates once as needs review while others convert', async () => {
		const host = await fixture();
		const path = 'Playlists/Broken.md';
		await host.app.vault.create(path, header);
		const malformed = '---\ntype: music-playlist\nsongs: [\n---\n';
		state(host.app).contents.set(path, malformed);
		const notice = vi.spyOn(noticeService, 'showNotice');

		await run(host);

		expect(notice).toHaveBeenCalledWith('migration_failed', {
			name: path, reason: expect.stringContaining('Needs review'),
		});
		expect(notices.filter((message) => message.includes(path))).toHaveLength(1);
		expect(notices.at(-1)).toBe(complete());
		expect(state(host.app).contents.get(notePath)).toContain(migrationEmbedBlock(basePath));
		expect(state(host.app).contents.get(path)).toBe(malformed);
		expect(host.settings.legacyPlaylistTrackProperty).toBe('songs');
	});

	it.each([false, true])('SC1 ignores stale playlist cache for malformed templates on rerun=%s', async (rerun) => {
		const host = await fixture();
		if (rerun) {
			await run(host);
			host.settings.legacyPlaylistTrackProperty = 'songs';
		}
		const path = 'Playlists/meeting.template.md';
		await host.app.vault.create(path, header);
		state(host.app).contents.set(path,
			'---\ntype: template\nparticipants:\n{{participants_yaml}}\n---\ntype: music-playlist\nsongs: []\n');
		notices.length = 0;

		await run(host);

		expect(notices).toEqual([rerun ? NOTICE_CATALOG.migration_already_bases.template : complete()]);
		expect(host.settings.legacyPlaylistTrackProperty).toBe('songs');
	});

	it.each([
		{ cache: 'missing', healthy: false, yaml: 'type: music-playlist\nbroken: [' },
		{ cache: 'other', healthy: false, yaml: 'type: "music-playlist"\nbroken: [' },
		{ cache: 'missing', healthy: true, yaml: "broken: [\ntype: 'music-playlist'" },
		{ cache: 'other', healthy: true, yaml: 'broken: [\nsongs : [' },
	])('SC2 reports malformed content with $cache cache and healthy=$healthy: $yaml', async ({ cache, healthy, yaml }) => {
		const host = await fixture();
		const fake = state(host.app);
		if (!healthy) {
			await run(host);
			host.settings.legacyPlaylistTrackProperty = 'songs';
		}
		const path = 'Playlists/Broken.md';
		await host.app.vault.create(path, '---\n{"type":"other"}\n---\n');
		if (cache === 'missing') fake.cache.delete(path);
		const malformed = `---\n${yaml}\n---\n`;
		fake.contents.set(path, malformed);
		notices.length = 0;
		const notice = vi.spyOn(noticeService, 'showNotice');

		await run(host);

		expect(notice).toHaveBeenCalledWith('migration_failed', {
			name: path, reason: expect.stringContaining('Needs review'),
		});
		expect(notices.filter((message) => message.includes(path))).toHaveLength(1);
		expect(notice).not.toHaveBeenCalledWith('migration_already_bases');
		if (healthy) expect(notices.at(-1)).toBe(complete());
		else expect(notices).toHaveLength(1);
		expect(fake.contents.get(path)).toBe(malformed);
		expect(host.settings.legacyPlaylistTrackProperty).toBe('songs');
	});

	it.each([
		{ yaml: 'songs.list: [', candidate: true },
		{ yaml: 'type: "mix[live]"', candidate: true },
		{ yaml: 'songsXlist: [', candidate: false },
		{ yaml: 'type: mixl', candidate: false },
		{ yaml: 'nested:\n  songs.list: [\n  type: mix[live]', candidate: false },
		{ yaml: '# songs.list: [\n# type: mix[live]', candidate: false },
	])('classifies malformed custom settings literally at top level: $yaml', async ({ yaml, candidate }) => {
		const host = await fixture();
		await run(host);
		host.settings.legacyPlaylistTrackProperty = 'songs.list';
		host.settings.playlistNoteType = 'mix[live]';
		const path = 'Playlists/Custom.md';
		await host.app.vault.create(path, '---\n{"type":"other"}\n---\n');
		state(host.app).cache.delete(path);
		state(host.app).contents.set(path, `---\nbroken: [\n${yaml}\n{{participants_yaml}}\n---\n`);
		notices.length = 0;
		const notice = vi.spyOn(noticeService, 'showNotice');

		await run(host);

		if (candidate) {
			expect(notice).toHaveBeenCalledWith('migration_failed', {
				name: path, reason: expect.stringContaining('Needs review'),
			});
			expect(notices).toHaveLength(1);
		} else expect(notices).toEqual([NOTICE_CATALOG.migration_already_bases.template]);
	});

	it('B12 reuses the actual embed after an equal-length edit before attachment', async () => {
		const host = await fixture();
		const fake = state(host.app);
		const note = await host.app.vault.create('Playlists/Late.md',
			'---\n{"type":"music-playlist","songs":[]}\n---\n[[Bases/Existing.base]] \nTail\n');
		await host.app.vault.create('Bases/Existing.base', 'views: []\n');
		fake.pauseIndexing = true;
		await host.app.vault.process(note, (text) => text.replace('[[Bases/Existing.base]] ', '![[Bases/Existing.base]]'));
		const cacheRead = vi.spyOn(host.app.metadataCache, 'getFileCache').mockImplementation(() => { throw new Error('Cache is not a decision source'); });

		await run(host, () => { fake.pauseIndexing = false; });

		expect([...fake.files.keys()].filter((path) => path.endsWith('.base'))).toEqual([ 'Bases/Existing.base', basePath ]);
		expect(fake.contents.get(note.path)).toContain('"tracks_legacy":[]');
		expect(fake.contents.get(note.path)?.match(/!\[\[/g)).toHaveLength(1);
		expect(cacheRead).not.toHaveBeenCalled();
	});

	it('B12 repairs rather than claiming no-op after an equal-length fence edit', async () => {
		const host = await fixture();
		const fake = state(host.app);
		const note = await host.app.vault.create('Playlists/Late.md',
			`${archived}aaa\n![[Bases/Existing.base]]\naaa\n`);
		await host.app.vault.create('Bases/Existing.base', 'views: []\n');
		fake.pauseIndexing = true;
		await host.app.vault.process(note, (text) => text.replaceAll('aaa', '```'));
		const notice = vi.spyOn(noticeService, 'showNotice');

		await run(host, () => { fake.pauseIndexing = false; });

		expect(notice).not.toHaveBeenCalledWith('migration_already_bases');
		expect(fake.contents.get(note.path)).toBe(`${archived}\`\`\`\n![[Bases/Existing.base]]\n\`\`\`\n\n![[Playlists/Late.base]]\n`);
		expect(notices.at(-1)).toBe(complete(2));
	});

	it.each(['missing', 'inconsistent', 'old frontmatter'])('B10-B11 converts idle content with %s public metadata', async (cache) => {
		const host = await fixture();
		const fake = state(host.app);
		if (cache === 'missing') fake.cache.delete(notePath);
		else {
			const entry = fake.cache.get(notePath);
			if (!entry) throw new Error('Missing fixture cache');
			if (cache === 'inconsistent') entry.sections = [];
			else entry.frontmatter = { type: 'other', songs: [] };
		}
		fake.asyncIndexing = true;

		await run(host);

		expect(fake.contents.get(notePath)).toContain(migrationEmbedBlock(basePath));
		expect(notices.at(-1)).toBe(complete());
		expect(fake.handlers.size).toBe(0);
		expect(fake.resolvedHandlers.size).toBe(0);
	});

	it('B9 rechecks actual content after settings persistence before claiming no-op', async () => {
		const host = await fixture();
		const fake = state(host.app);
		await run(host);
		host.settings.legacyPlaylistTrackProperty = 'songs';
		host.saveSettings.mockImplementationOnce(async () => {
			fake.contents.set(notePath, fake.contents.get(notePath)?.replace(migrationEmbedBlock(basePath), '') ?? '');
		});
		const notice = vi.spyOn(noticeService, 'showNotice');

		await convertPlaylistNotes(host);

		expect(notice).not.toHaveBeenCalledWith('migration_already_bases');
		expect(notice).toHaveBeenCalledWith('migration_failed', expect.objectContaining({ name: notePath }));
	});

	it('writes no marker on fresh conversion and performs a byte-identical no-op on rerun', async () => {
		const host = await fixture();
		const fake = state(host.app);
		await run(host);
		expect(fake.contents.get(notePath)).toBe('---\n{"type":"music-playlist","tracks_legacy":["[[Tracks/A]]"]}\n---\nOriginal body\n\n![[Playlists/Mix.base]]\n');
		const before = new Map(fake.contents);
		const write = vi.fn();
		fake.onWrite = write;
		const notice = vi.spyOn(noticeService, 'showNotice');

		await convertPlaylistNotes(host);

		expect(notice).toHaveBeenCalledWith('migration_already_bases');
		expect(fake.contents).toEqual(before);
		expect(write).not.toHaveBeenCalled();
	});

	it.each(['---\n{"type":"music-playlist"}\n---\n'])(
		'lists remaining candidates without owned archived blocks', async (text) => {
			const host = await fixture();
			const fake = state(host.app);
			await host.app.vault.create(basePath, 'views: []\n');
			fake.contents.set(notePath, text);
			const before = new Map(fake.contents);
			const notice = vi.spyOn(noticeService, 'showNotice');

			await run(host);

			expect(notice).not.toHaveBeenCalledWith('migration_already_bases');
			expect(notice).toHaveBeenCalledWith('migration_failed', { name: notePath, reason: expect.stringContaining('Needs review') });
			expect(fake.contents).toEqual(before);
		},
	);

	it.each(['`![[Playlists/Mix.base]]`', '```\n![[Playlists/Mix.base]]\n', '![[Playlists/Mix.base]]\n![[Playlists/Mix.base]]'])(
		'reports ambiguous embeds as needs review without writes: %s', async (body) => {
			const host = await fixture();
			const fake = state(host.app);
			await host.app.vault.create(basePath, 'views: []\n');
			fake.contents.set(notePath, header + body);
			const before = new Map(fake.contents);
			const notice = vi.spyOn(noticeService, 'showNotice');

			await run(host);

			expect(fake.contents).toEqual(before);
			expect(notice).toHaveBeenCalledWith('migration_failed', { name: notePath, reason: expect.stringContaining('Needs review') });
		},
	);

	it('uses current atomic callback content when a different base appears after preview', async () => {
		const host = await fixture();
		const fake = state(host.app);
		await host.app.vault.create('Bases/User.base', 'views: []\n');
		const process = host.app.vault.process.bind(host.app.vault);
		vi.spyOn(host.app.vault, 'process').mockImplementationOnce((file, edit) => {
			fake.contents.set(file.path, `${fake.contents.get(file.path)}\n![[Bases/User.base]]\n`);
			return process(file, edit);
		});

		await run(host);

		expect([...fake.files.keys()].filter((path) => path.endsWith('.base'))).toEqual(['Bases/User.base']);
		expect(fake.contents.get(notePath)).toContain('"songs":');
		expect(notices.at(-1)).toContain(complete(0, 0));
	});

	it('B6 recovers after base creation and membership interruptions', async () => {
		const host = await fixture();
		const fake = state(host.app);
		const create = host.app.vault.create.bind(host.app.vault);
		vi.spyOn(host.app.vault, 'create').mockRejectedValueOnce(new Error('Base write interrupted')).mockImplementation(create);
		await run(host);
		expect(fake.files.has(basePath)).toBe(false);
		expect(fake.contents.get(notePath)).toBe('---\n{"type":"music-playlist","tracks_legacy":["[[Tracks/A]]"]}\n---\nOriginal body\n');
		vi.spyOn(host.app.fileManager, 'processFrontMatter').mockRejectedValueOnce(new Error('Membership interrupted'));
		await run(host);

		await run(host);

		expect([...fake.files.keys()].filter((path) => path.endsWith('.base'))).toEqual([basePath]);
		expect(fake.contents.get(notePath)?.match(/!\[\[/g)).toEqual(['![[']);
		expect(notices.at(-1)).toBe(complete());
	});

	it('B6 recovers a legacy marked archive whose base was never created', async () => {
		const host = await fixture();
		const fake = state(host.app);
		const legacy = '---\n{"type":"music-playlist","tracks_legacy":["[[Tracks/A]]"]}\n---\nBody\n\n%% note-player:playlist-base %%\n![[Playlists/Mix.base]]\n';
		fake.contents.set(notePath, legacy);

		await run(host);

		expect(fake.contents.get(notePath)).toBe(legacy);
		expect([...fake.files.keys()].filter((path) => path.endsWith('.base'))).toEqual([basePath]);
		expect(fake.contents.get('Tracks/A.md')).toContain('"playlists":["[[Other]]","[[Playlists/Mix]]"]');
		expect(notices.at(-1)).toBe(complete());
	});

	it.each([false, true])('B6 retries an interrupted atomic archive/embed write afterWrite=%s', async (afterWrite) => {
		const host = await fixture();
		const fake = state(host.app);
		const process = host.app.vault.process.bind(host.app.vault);
		vi.spyOn(host.app.vault, 'process').mockImplementationOnce(async (file, edit) => {
			if (afterWrite) await process(file, edit);
			throw new Error('Conversion interrupted');
		});
		await run(host);

		await run(host);

		expect([...fake.files.keys()].filter((path) => path.endsWith('.base'))).toEqual([basePath]);
		expect(fake.contents.get(notePath)?.match(/!\[\[/g)).toHaveLength(1);
		expect(fake.contents.get(notePath)).toContain('"tracks_legacy":["[[Tracks/A]]"]');
		expect(notices.at(-1)).toBe(complete());
	});

	it.each([false, true])('B6 reuses the reserved base after interrupted embed attachment afterWrite=%s', async (afterWrite) => {
		const host = await fixture();
		const fake = state(host.app);
		const process = host.app.vault.process.bind(host.app.vault);
		vi.spyOn(host.app.vault, 'process').mockImplementationOnce(process).mockImplementationOnce(async (file, edit) => {
			if (afterWrite) await process(file, edit);
			throw new Error('Embed attachment interrupted');
		});
		await run(host);

		await run(host);

		expect([...fake.files.keys()].filter((path) => path.endsWith('.base'))).toEqual([basePath]);
		expect(fake.contents.get(notePath)).toBe('---\n{"type":"music-playlist","tracks_legacy":["[[Tracks/A]]"]}\n---\nOriginal body\n\n![[Playlists/Mix.base]]\n');
		expect(notices.at(-1)).toBe(complete());
	});

	it.each([
		{ body: '> ~~~md\n> ![[Playlists/Mix.base]]\n> ~~~\n', embeds: [], append: true },
		{ body: '`example\n\n![[Playlists/Mix.base]]\n\n`end\n', embeds: [basePath], append: false },
	])('B7-B8 preserves block boundaries through post-write confirmation: $body', async ({ body, embeds, append }) => {
		const host = await fixture();
		const fake = state(host.app);
		await host.app.vault.create(basePath, '# note-player migration for: "Playlists/Mix.md"\nviews: []\n');
		fake.contents.set(notePath, header + body);
		const expected = append ? `${body}\n${migrationEmbedBlock(basePath)}\n` : body;
		// SDK boundary fixture: native Markdown parsing is not delegated to the test fake.
		fake.parsedBodies.set(expected, append ? [basePath] : embeds);

		await run(host);

		expect(fake.contents.get(notePath)?.split('\n').slice(3).join('\n')).toBe(expected);
		expect(notices.at(-1)).toBe(complete());
	});

});
