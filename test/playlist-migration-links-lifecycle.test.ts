import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App, Component } from 'obsidian';
import { DEFAULT_SETTINGS } from '../src/domain/config';
import { NOTICE_CATALOG, renderNotice } from '../src/domain/notices';
import { convertPlaylistNotes } from '../src/services/playlist-migration-service';
import { collectNoteSnapshots } from '../src/services/vault-io';
import { buildMusicLibrary } from '../src/domain/library-index';
import { notices, state } from './helpers/migration-obsidian';

vi.mock('obsidian', () => import('./helpers/migration-obsidian'));
vi.mock('../src/ui/views/MigrationPreviewModal', () => ({
	MigrationPreviewModal: class {
		constructor(_app: unknown, _plan: unknown, private readonly finish: (confirm: boolean) => void) {}
		open() { this.finish(true); }
		showProgress() {}
		close() {}
	},
}));

const owners: Component[] = [];
const notePath = 'Playlists/Mix.md';
const basePath = 'a/b/X.base';
const complete = renderNotice(NOTICE_CATALOG.migration_complete.template, { playlists: 1, tracks: 0, missing: 0 });

async function fixture(body: string) {
	const app = new App();
	await app.vault.create(basePath, 'views: []\n');
	const note = await app.vault.create(notePath, `---\n{"type":"music-playlist","songs":[]}\n---\n${body}\n`);
	const owner = new Component();
	owner.load();
	owners.push(owner);
	const host = Object.assign(owner, {
		app, settings: { ...DEFAULT_SETTINGS, playlistFolder: 'Playlists', legacyPlaylistTrackProperty: 'songs' },
		saveSettings: vi.fn(() => Promise.resolve()),
	});
	return { host, note, fake: state(app) };
}

beforeEach(() => {
	notices.length = 0;
	vi.stubGlobal('activeWindow', { setTimeout, clearTimeout });
});
afterEach(() => {
	for (const owner of owners.splice(0)) owner.unload();
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

it.each(['![[a/b/X.base]]', '![[a/b/X.base|Alias]]', '> ![[a/b/X.base]]'])(
	'B13 unchanged user-embed rerun is a byte-identical already-converted no-op: %s', async (body) => {
		const { host, note, fake } = await fixture(body);
		await convertPlaylistNotes(host);
		expect(notices.at(-1)).toBe(complete);
		const before = new Map(fake.contents);
		const stat = { ...note.stat };
		const write = vi.fn();
		fake.onWrite = write;

		await convertPlaylistNotes(host);

		expect(notices.at(-1)).toBe(renderNotice(NOTICE_CATALOG.migration_already_bases.template));
		expect(fake.contents).toEqual(before);
		expect(note.stat).toEqual(stat);
		expect(write).not.toHaveBeenCalled();
	},
);

it.each(['X.base', 'X.base|Alias', 'X.base#View|Alias', 'X.base#^row', '../a/b/X.base'])(
	'B14 reuses a public-resolved explicit .base embed without appending another: %s', async (target) => {
		const { host, note, fake } = await fixture(`![[${target}]]`);
		const base = host.app.vault.getFileByPath(basePath);
		const resolve = host.app.metadataCache.getFirstLinkpathDest.bind(host.app.metadataCache);
		vi.spyOn(host.app.metadataCache, 'getFirstLinkpathDest').mockImplementation((link, source) =>
			['X.base', '../a/b/X.base'].includes(link) && source === notePath ? base : resolve(link, source));

		await convertPlaylistNotes(host);

		expect([...fake.files.keys()].filter((path) => path.endsWith('.base'))).toEqual([basePath]);
		expect(fake.contents.get(note.path)).toBe(`---\n{"type":"music-playlist","tracks_legacy":[]}\n---\n![[${target}]]\n`);
		expect(notices.at(-1)).toBe(complete);
	},
);

it.each(['X', 'X|Alias', 'a/b/X'])('reports an unresolved extensionless embed without redirecting it to a base: %s', async (target) => {
	const embed = `![[${target}]]`;
	const { host, fake } = await fixture(embed);
	const before = new Map(fake.contents);

	await convertPlaylistNotes(host);

	expect(fake.contents).toEqual(before);
	expect([...fake.files.keys()].filter((path) => path.endsWith('.base'))).toEqual([basePath]);
	expect(notices.at(-1)).toContain(embed);
	expect(notices.at(-1)).toContain('.base');
	expect(host.saveSettings).not.toHaveBeenCalled();
});

it.each(['#ViewName', '#^row'])('retains a migrated subpath %s companion in the library with every resolved track', async (subpath) => {
	const { host, note, fake } = await fixture(`![[${basePath}${subpath}]]`);
	const track = await host.app.vault.create('Tracks/A.md',
		'---\n{"type":"music","source":"https://youtu.be/dQw4w9WgXcQ"}\n---\nTrack body\n');
	const legacy = ['[[Tracks/A]]', '[[Missing]]'];
	await host.app.vault.process(note, () =>
		`---\n${JSON.stringify({ type: 'music-playlist', songs: legacy })}\n---\n![[${basePath}${subpath}]]\n`);

	await convertPlaylistNotes(host);
	const snapshots = collectNoteSnapshots(host.app, ['Playlists'], host.settings);
	const library = buildMusicLibrary(snapshots, host.settings, new Map());

	expect(library.playlists.map((playlist) => ({
		path: playlist.path, base: playlist.basePath, tracks: playlist.trackPaths, queueLength: playlist.tracks.length,
	}))).toEqual([{ path: notePath, base: basePath, tracks: [track.path], queueLength: 1 }]);
	expect(fake.cache.get(notePath)?.frontmatter.tracks_legacy).toEqual(legacy);
	expect([...fake.files.keys()].filter((path) => path.endsWith('.base'))).toEqual([basePath]);
	expect(fake.contents.get(notePath)?.split('\n').slice(3).join('\n')).toBe(`![[${basePath}${subpath}]]\n`);
	const before = new Map(fake.contents);

	await convertPlaylistNotes(host);

	expect(fake.contents).toEqual(before);
	expect(notices.at(-1)).toBe(renderNotice(NOTICE_CATALOG.migration_already_bases.template));
});

it.each(['note', 'membership'])('B15 unload during pending %s confirmation detaches listeners and prevents further writes', async (phase) => {
	const { host, note, fake } = await fixture('Body');
	if (phase === 'membership') {
		await host.app.vault.create('Tracks/A.md', '---\n{"type":"music"}\n---\n');
		await host.app.vault.process(note, () => '---\n{"type":"music-playlist","songs":["[[Tracks/A]]"]}\n---\nBody\n');
	}
	vi.useFakeTimers();
	const timers = { setTimeout, clearTimeout };
	fake.pauseIndexing = true;
	let waiting: () => void = () => {};
	const signal = new Promise<void>((resolve) => { waiting = resolve; });
	vi.stubGlobal('activeWindow', {
		setTimeout: (callback: () => void, delay: number) => {
			const timer = timers.setTimeout(callback, delay);
			waiting();
			return timer;
		},
		clearTimeout: timers.clearTimeout,
	});
	fake.onWrite = (file) => { if (phase === 'membership' && file.path === notePath) fake.flush(); };
	const done = convertPlaylistNotes(host);
	await signal;
	const before = new Map(fake.contents);
	host.unload();
	try {
		expect(fake.handlers.size).toBe(0);
		expect(vi.getTimerCount()).toBe(0);
	} finally {
		fake.pauseIndexing = false;
		fake.flush();
		await done;
	}
	expect(fake.contents).toEqual(before);
	expect([...fake.files.keys()].filter((path) => path.endsWith('.base'))).toEqual(
		phase === 'note' ? [basePath] : [basePath, 'Playlists/Mix.base'],
	);
	expect(host.saveSettings).not.toHaveBeenCalled();
});
