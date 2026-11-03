import { describe, expect, it } from 'vitest';
import { collectScopedFiles, type ScopeTree } from '../src/domain/music-scope';

const subfolders: Record<string, string[]> = { '/': ['Deep', 'Music'], 'Music': ['Music/Sub'] };
const notes: Record<string, string[]> = {
	'/': ['Root track.md', 'Road Trip.md'],
	'Deep': ['Deep/Nested track.md', 'Deep/Linked track.md'],
	'Music': ['Music/A.md'],
	'Music/Sub': ['Music/Sub/B.md'],
};

function tree(links: Record<string, string[]> = {}): ScopeTree<string, string> {
	return {
		children: (folder) => ({ folders: subfolders[folder] ?? [], files: notes[folder] ?? [] }),
		linked: (file) => links[file] ?? [],
	};
}

describe('collectScopedFiles', () => {
	it('reads all descendants of the vault root', () => {
		const files = collectScopedFiles([{ folder: '/', isVaultRoot: true }], tree());
		expect(files).toEqual([
			'Root track.md', 'Road Trip.md', 'Deep/Nested track.md', 'Deep/Linked track.md',
			'Music/A.md', 'Music/Sub/B.md',
		]);
	});

	it('adds notes a collected playlist links to, even outside the scope', () => {
		const files = collectScopedFiles([{ folder: 'Music', isVaultRoot: false }], tree({ 'Music/A.md': ['Deep/Linked track.md'] }));
		expect(files).toEqual(['Music/A.md', 'Music/Sub/B.md', 'Deep/Linked track.md']);
		expect(files).not.toContain('Deep/Nested track.md');
	});

	it('recurses into a configured subfolder', () => {
		const files = collectScopedFiles([{ folder: 'Music', isVaultRoot: false }], tree());
		expect(files).toEqual(['Music/A.md', 'Music/Sub/B.md']);
	});
});
