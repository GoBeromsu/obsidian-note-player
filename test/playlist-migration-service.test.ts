import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian';
import { DEFAULT_SETTINGS } from '../src/domain/config';
import { convertPlaylistNotes } from '../src/services/playlist-migration-service';
import { observeTestMetadata } from './helpers/migration-lifecycle';
import { state } from './helpers/migration-obsidian';
import type { PlaylistMigrationPlan } from '../src/domain/playlist-migration';

const preview = vi.hoisted(() => ({
	plan: undefined as PlaylistMigrationPlan | undefined,
	finish: undefined as ((confirmed: boolean) => void) | undefined,
	opened: () => {},
}));
const observers: (() => void)[] = [];

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
	observers.push(observeTestMetadata(app));
	await seed(app, 'Playlists/Mix.md', { type: 'music-playlist', [legacyKey]: ['[[Tracks/A]]', '[[Missing]]'] });
	await seed(app, 'Tracks/A.md', { type: 'music', playlists: ['[[Other]]'] });
	state(app).resolve();
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
	vi.stubGlobal('activeWindow', { setTimeout, clearTimeout });
	preview.plan = undefined;
	preview.finish = undefined;
});

afterEach(() => {
	for (const dispose of observers.splice(0)) dispose();
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
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

		expect(await readNote(host.app, 'Playlists/Mix.md')).toContain('"songs":');
		expect(await readNote(host.app, 'Playlists/Next.md')).toContain('"tracks_legacy":[]');
		expect(host.settings.legacyPlaylistTrackProperty).toBe('songs');
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
