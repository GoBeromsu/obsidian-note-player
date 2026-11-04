import { describe, expect, it } from 'vitest';
import { collectScopedFiles } from '../src/domain/music-scope';

const notes = [
	'Root track.md', 'Road Trip.md', 'Deep/Nested track.md', 'Deep/Linked track.md',
	'Music/A.md', 'Music/Sub/B.md',
].map((path) => ({ path }));
const paths = (files: readonly { path: string }[]) => files.map((file) => file.path);

describe('collectScopedFiles', () => {
	it('reads all descendants of the vault root', () => {
		const files = collectScopedFiles(notes, ['/'], () => []);
		expect(paths(files)).toEqual([
			'Root track.md', 'Road Trip.md', 'Deep/Nested track.md', 'Deep/Linked track.md',
			'Music/A.md', 'Music/Sub/B.md',
		]);
	});

	it('adds notes a collected playlist links to, even outside the scope', () => {
		const files = collectScopedFiles(notes, ['Music'], (file) =>
			file.path === 'Music/A.md' ? notes.filter((note) => note.path === 'Deep/Linked track.md') : []);
		expect(paths(files)).toEqual(['Music/A.md', 'Music/Sub/B.md', 'Deep/Linked track.md']);
		expect(paths(files)).not.toContain('Deep/Nested track.md');
	});

	it('recurses into a configured subfolder', () => {
		const files = collectScopedFiles(notes, ['Music'], () => []);
		expect(paths(files)).toEqual(['Music/A.md', 'Music/Sub/B.md']);
	});
});
