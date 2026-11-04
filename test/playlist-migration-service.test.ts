import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, Component, Notice } from 'obsidian';
import { DEFAULT_SETTINGS } from '../src/domain/config';
import { convertPlaylistNotes } from '../src/services/playlist-migration-service';
import { notices, state } from './helpers/migration-obsidian';
import { NOTICE_CATALOG, renderNotice } from '../src/domain/notices';
import type { PlaylistMigrationPlan } from '../src/domain/playlist-migration';

const preview = vi.hoisted(() => ({
	plan: undefined as PlaylistMigrationPlan | undefined,
	finish: undefined as ((confirmed: boolean) => void) | undefined,
	opened: () => {},
}));
const owners: Component[] = [];

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

vi.mock('obsidian', () => import('./helpers/migration-obsidian'));

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
	state(app).resolve();
	const owner = new Component();
	owner.load();
	owners.push(owner);
	return Object.assign(owner, {
		app,
		settings: { ...DEFAULT_SETTINGS, playlistFolder: 'Playlists', legacyPlaylistTrackProperty: legacyKey },
		saveSettings: vi.fn(() => Promise.resolve()),
	});
}

async function openPreview(host: Awaited<ReturnType<typeof fixture>>) {
	let ready: () => void = () => {};
	const opened = new Promise<void>((resolve) => { ready = resolve; });
	preview.opened = ready;
	const done = convertPlaylistNotes(host);
	await Promise.race([opened, done]);
	return { done };
}

beforeEach(() => {
	notices.length = 0;
	vi.stubGlobal('activeWindow', { setTimeout, clearTimeout });
	preview.plan = undefined;
	preview.finish = undefined;
});

afterEach(() => {
	for (const owner of owners.splice(0)) owner.unload();
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('playlist migration service', () => {
	it.each([1, 2])('upgrades only paired custom views and is byte-identical on rerun: %i bases', async (count) => {
		const host = await fixture();
		const note = host.app.vault.getFileByPath('Playlists/Mix.md');
		if (!note) throw new Error('Missing playlist fixture');
		await host.app.vault.process(note, () =>
			'---\n{"type":"music-playlist","tracks_legacy":[]}\n---\n![[Bases/Collection.base]]\n');
		const source = '# Keep this comment\nfilters:\n  and:\n    - \'type == "music"\'\nviews:\n  - type: note-player # custom\n    name: "Player"\n    filters: \'author == "A"\'\n    sort:\n      - property: file.mtime\n        direction: DESC\n    order: [file.name, note.author]\n  - type: table\n    name: "My table"\n    order: [file.name]\n  - {type: note-player, name: Extra, sort: []}\n';
		const expected = source.replace('type: note-player # custom\n', 'type: cards # custom\n    image: "note.poster"\n')
			.replace('{type: note-player,', '{type: cards, image: "note.poster",');
		await host.app.vault.create('Bases/Collection.base', source);
		await host.app.vault.create('Bases/Unpaired.base', source);
		// A matching filename without an embed is not a pairing.
		await host.app.vault.create('Playlists/Mix.base', source);
		if (count === 2) {
			await host.app.vault.create('Bases/Second.base', source);
			await host.app.vault.create('Playlists/Second.md',
				'---\n{"type":"music-playlist","tracks_legacy":[]}\n---\n![[Bases/Second.base]]\n');
		}
		host.settings.musicThumbnailProperty = 'poster';
		const { done } = await openPreview(host);
		expect(preview.plan?.cardsUpgrades?.map((base) => base.basePath)).toEqual(
			count === 1 ? ['Bases/Collection.base'] : ['Bases/Collection.base', 'Bases/Second.base']);
		preview.finish?.(true);
		await done;
		expect(await readNote(host.app, 'Bases/Collection.base')).toBe(expected);
		expect(await readNote(host.app, 'Bases/Unpaired.base')).toBe(source);
		expect(await readNote(host.app, 'Playlists/Mix.base')).toBe(source);
		expect(notices.at(-1)).toContain(count === 1
			? '1 playlist base switched to the cards view.' : '2 playlist bases switched to the cards view.');
		const before = [...state(host.app).contents];
		const write = vi.spyOn(host.app.vault, 'process');

		await convertPlaylistNotes(host);

		expect([...state(host.app).contents]).toEqual(before);
		expect(write).not.toHaveBeenCalled();
		expect(notices.at(-1)).toBe('All playlists already use Bases.');
	});

	it('shows the playlist basename during conversion', async () => {
		const messages: string[] = [];
		vi.spyOn(Notice.prototype, 'setMessage').mockImplementation(function (this: Notice, message) {
			messages.push(typeof message === 'string' ? message : message.textContent ?? '');
			return this;
		});
		const host = await fixture();
		const { done } = await openPreview(host);

		preview.finish?.(true);
		await done;

		expect(messages).toEqual(['Converting Mix...']);
	});

	it.each([1, 2])('pluralizes converted playlists and linked tracks for count %i', async (count) => {
		const host = await fixture();
		if (count === 2) {
			await seed(host.app, 'Playlists/Next.md', { type: 'music-playlist', songs: ['[[Tracks/B]]'] });
			await seed(host.app, 'Tracks/B.md', { type: 'music' });
		}
		const { done } = await openPreview(host);

		preview.finish?.(true);
		await done;

		expect(notices.at(-1)).toBe(count === 1
			? 'Converted 1 playlist, linked 1 track, 1 missing.'
			: 'Converted 2 playlists, linked 2 tracks, 1 missing.');
	});

	it('waits for byte-matched post-write indexing and cleans temporary listeners', async () => {
		const host = await fixture();
		const fake = state(host.app);
		fake.pauseIndexing = true;
		let written: () => void = () => {};
		const signal = new Promise<void>((resolve) => { written = resolve; });
		fake.onWrite = (file) => { if (file.path === 'Playlists/Mix.md') written(); };
		const { done } = await openPreview(host);
		let completed = false;
		void done.then(() => { completed = true; });
		preview.finish?.(true);
		await signal;
		expect(completed).toBe(false);
		expect(fake.handlers.size).toBe(1);

		fake.pauseIndexing = false;
		fake.flush();
		await done;

		expect(fake.handlers.size).toBe(0);
		expect(notices.at(-1)).toBe(renderNotice(NOTICE_CATALOG.migration_complete.template, { playlists: 1, tracks: 1, missing: 1 }));
	});

	it('times out post-write indexing truthfully and reuses the owned block on retry', async () => {
		const host = await fixture();
		const fake = state(host.app);
		fake.pauseIndexing = true;
		vi.useFakeTimers();
		vi.stubGlobal('activeWindow', { setTimeout, clearTimeout });
		const { done } = await openPreview(host);
		preview.finish?.(true);
		await vi.runAllTimersAsync();
		await done;
		expect(notices.at(-1)).toContain(renderNotice(NOTICE_CATALOG.migration_complete.template, { playlists: 0, tracks: 0, missing: 0 }));
		expect(fake.handlers.size).toBe(0);
		fake.pauseIndexing = false;
		fake.flush();

		const retry = await openPreview(host);
		preview.finish?.(true);
		await retry.done;

		expect([...fake.files.keys()].filter((path) => path.endsWith('.base'))).toEqual(['Playlists/Mix.base']);
		expect(fake.contents.get('Playlists/Mix.md')?.match(/!\[\[/g)).toHaveLength(1);
		expect(notices.at(-1)).toBe(renderNotice(NOTICE_CATALOG.migration_complete.template, { playlists: 1, tracks: 1, missing: 1 }));
	});

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

	it('joins overlapping invocations until conversion writes have finished', async () => {
		const host = await fixture();
		let entered: () => void = () => {};
		let release: () => void = () => {};
		const writeStarted = new Promise<void>((resolve) => { entered = resolve; });
		const writeGate = new Promise<void>((resolve) => { release = resolve; });
		const write = host.app.fileManager.processFrontMatter.bind(host.app.fileManager);
		vi.spyOn(host.app.fileManager, 'processFrontMatter').mockImplementationOnce(async (file, edit) => {
			entered();
			await writeGate;
			await write(file, edit);
		});
		const { done } = await openPreview(host);

		preview.finish?.(true);
		await writeStarted;
		try {
			expect(convertPlaylistNotes(host)).toBe(done);
		} finally {
			release();
			await done;
		}

		expect(await readNote(host.app, 'Tracks/A.md')).toContain(
			'"playlists":["[[Other]]","[[Playlists/Mix]]"]',
		);
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

		expect(await readNote(host.app, 'Tracks/A.md')).toContain('"playlists":["[[Other]]"]');
		expect(await readNote(host.app, 'Playlists/Next.md')).toContain('"tracks_legacy":[]');
		expect(host.settings.legacyPlaylistTrackProperty).toBeUndefined();
	});

	it('does not duplicate bases or memberships when metadata still contains the legacy state', async () => {
		const host = await fixture('tracks');
		const stale = { type: 'music-playlist', tracks: ['[[Tracks/A]]', '[[Missing]]'] };
		const { done } = await openPreview(host);
		preview.finish?.(true);
		await done;
		vi.spyOn(host.app.metadataCache, 'getFileCache').mockReturnValue({ frontmatter: stale });
		const paths = host.app.vault.getAllLoadedFiles().map((file) => file.path);
		const note = await readNote(host.app, 'Playlists/Mix.md');
		const track = await readNote(host.app, 'Tracks/A.md');

		vi.useFakeTimers();
		vi.stubGlobal('activeWindow', { setTimeout, clearTimeout });
		const rerun = convertPlaylistNotes(host);
		await vi.runAllTimersAsync();
		await rerun;

		expect(host.app.vault.getAllLoadedFiles().map((file) => file.path)).toEqual(paths);
		expect(await readNote(host.app, 'Playlists/Mix.md')).toBe(note);
		expect(await readNote(host.app, 'Tracks/A.md')).toBe(track);
	});
});
