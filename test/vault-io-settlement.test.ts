import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App, Component } from 'obsidian';
import { updateFrontmatter, withMetadataSettled } from '../src/services/vault-io';
import { state } from './helpers/migration-obsidian';

vi.mock('obsidian', () => import('./helpers/migration-obsidian'));

function signal() {
	let resolve: () => void = () => {};
	const promise = new Promise<void>((done) => { resolve = done; });
	return { promise, resolve };
}

let owner: Component;
beforeEach(() => {
	owner = new Component();
	owner.load();
	vi.stubGlobal('activeWindow', { setTimeout, clearTimeout });
});
afterEach(() => { owner.unload(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('ignores a stale same-file event delivered before the frontmatter write finishes', async () => {
	const app = new App();
	const file = await app.vault.create('Track.md', '---\n{"type":"music"}\n---\nBody\n');
	const fake = state(app);
	fake.pauseIndexing = true;
	const before = await app.vault.read(file);
	const entered = signal();
	const release = signal();
	const written = signal();
	fake.onWrite = written.resolve;
	const write = app.fileManager.processFrontMatter.bind(app.fileManager);
	vi.spyOn(app.fileManager, 'processFrontMatter').mockImplementationOnce(async (track, edit) => {
		entered.resolve();
		await release.promise;
		await write(track, edit);
	});
	let completed = false;
	const done = updateFrontmatter({ app, owner }, file.path, (fm) => { fm.playlists = ['[[Mix]]']; })
		.then(() => { completed = true; });
	await entered.promise;
	const indexedFile = fake.files.get(file.path);
	if (!indexedFile) throw new Error('Missing fake file');
	fake.index(indexedFile, before);
	release.resolve();
	await written.promise;
	expect(completed).toBe(false);
	expect(fake.handlers.size).toBe(1);

	fake.flush();
	await done;

	expect(fake.cache.get(file.path)?.frontmatter.playlists).toEqual(['[[Mix]]']);
	expect(fake.handlers.size).toBe(0);
});

it('returns only the public cache receipt for the bytes written after subscription', async () => {
	const app = new App();
	const file = await app.vault.create('Note.md', '---\n{"type":"old"}\n---\nBody\n');

	const cache = await withMetadataSettled({ app, owner }, file, async () => {
		await app.vault.process(file, (text) => text.replace('old', 'new'));
	});

	expect(cache?.frontmatter?.type).toBe('new');
	expect(state(app).handlers.size).toBe(0);
});

it('does not start a write when the owner unloads during the pre-write read', async () => {
	const app = new App();
	const file = await app.vault.create('Note.md', '---\n{"type":"old"}\n---\nBody\n');
	const entered = signal();
	const release = signal();
	const read = app.vault.read.bind(app.vault);
	vi.spyOn(app.vault, 'read').mockImplementationOnce(async (note) => {
		entered.resolve();
		await release.promise;
		return read(note);
	});
	const write = vi.fn(() => Promise.resolve());
	const done = withMetadataSettled({ app, owner }, file, write);
	const rejected = expect(done).rejects.toThrow('cancelled');
	await entered.promise;

	owner.unload();
	release.resolve();
	await rejected;

	expect(write).not.toHaveBeenCalled();
	expect(state(app).handlers.size).toBe(0);
});
