import { describe, it, expect } from 'vitest';
import { dedupe, sanitizeFileName } from '../src/utils/dedupe';

describe('dedupe', () => {
	it('removes duplicate values', () => {
		expect(dedupe(['a', 'b', 'a', 'c', 'b'])).toEqual(['a', 'b', 'c']);
	});

	it('preserves insertion order', () => {
		expect(dedupe(['c', 'b', 'a'])).toEqual(['c', 'b', 'a']);
	});

	it('returns empty array for empty input', () => {
		expect(dedupe([])).toEqual([]);
	});

	it('returns single element unchanged', () => {
		expect(dedupe(['only'])).toEqual(['only']);
	});

	it('handles all duplicates', () => {
		expect(dedupe(['x', 'x', 'x'])).toEqual(['x']);
	});
});

describe('sanitizeFileName', () => {
	it('returns trimmed input unchanged when valid', () => {
		expect(sanitizeFileName('My Playlist')).toBe('My Playlist');
	});

	it('replaces forbidden characters with spaces', () => {
		expect(sanitizeFileName('a\\b/c:d*e?f"g<h>i|j')).toBe('a b c d e f g h i j');
	});

	it('collapses multiple spaces', () => {
		expect(sanitizeFileName('hello   world')).toBe('hello world');
	});

	it('returns default name for empty input', () => {
		expect(sanitizeFileName('')).toBe('New Playlist');
	});

	it('returns default name for whitespace-only input', () => {
		expect(sanitizeFileName('   ')).toBe('New Playlist');
	});

	it('trims leading and trailing whitespace', () => {
		expect(sanitizeFileName('  My Playlist  ')).toBe('My Playlist');
	});
});
