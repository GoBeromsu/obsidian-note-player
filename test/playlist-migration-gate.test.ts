import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian';
import { DEFAULT_SETTINGS } from '../src/domain/config';
import { NOTICE_CATALOG, renderNotice } from '../src/domain/notices';
import { convertPlaylistNotes } from '../src/services/playlist-migration-service';
import { updateFrontmatter } from '../src/services/vault-io';
import * as noticeService from '../src/ui/notices';
import type { PlaylistMigrationPlan } from '../src/domain/playlist-migration';
import { notices, state } from './helpers/migration-obsidian';

const preview = vi.hoisted(() => ({
	plan: undefined as PlaylistMigrationPlan | undefined,
	finish: undefined as ((confirmed: boolean) => void) | undefined,
	opened: () => {},
}));
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

async function fixture() {
	const app = new App();
	await app.vault.create('Playlists/Mix.md', '---\n{"type":"music-playlist","songs":["[[Tracks/A]]"]}\n---\nOriginal body\n');
	await app.vault.create('Tracks/A.md', '---\n{"type":"music","playlists":["[[Other]]"]}\n---\nTrack body\n');
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
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('migration gate regressions', () => {
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
		fake.cache.delete('Playlists/Mix.md');
		const notice = vi.spyOn(noticeService, 'showNotice');

		await convertPlaylistNotes(host);

		expect(notice).not.toHaveBeenCalledWith('migration_already_bases');
		expect(notice).toHaveBeenCalledWith('migration_failed', expect.objectContaining({ name: 'Playlists/Mix.md' }));
		expect(fake.contents.get('Playlists/Mix.md')).toContain('"songs":');
		notice.mockRestore();
	});

	it('keeps the indexed conversion pending until metadata acknowledges its write', async () => {
		const host = await fixture();
		const fake = state(host.app);
		fake.pauseIndexing = true;
		const boundary = signal<'subscribed' | 'completed'>();
		const written = signal<void>();
		fake.onSubscribe = () => boundary.resolve('subscribed');
		fake.onWrite = (file) => {
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
		expect(fake.handlers.size).toBe(0);
	});

	it('ignores a stale same-file event delivered before the frontmatter write finishes', async () => {
		const host = await fixture();
		const fake = state(host.app);
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
			expect(fake.handlers.size).toBe(1);
		} finally {
			release.resolve();
			await written.promise;
			fake.flush();
			await done;
		}
		expect(fake.cache.get(file.path)?.frontmatter.playlists).toEqual(['[[Playlists/Mix]]']);
		expect(fake.handlers.size).toBe(0);
	});
});
