import { describe, it, expect } from 'vitest';
import {
	resolveSelectedPlaylistPath,
	getPlaylistOrThrow,
	toPlaylistSummary,
	moveValue,
	toPlaylistTrack,
	moveItem,
	successorAfterRemoval,
} from '../src/domain/playlist-manager';
import type { MusicTrack, PlaylistNote } from '../src/types/music';

function makePlaylist(path: string, trackPaths: string[] = []): PlaylistNote {
	return {
		path,
		basePath: path.replace(/\.md$/, '.base'),
		title: path.replace(/\.md$/, ''),
		coverUrl: '',
		description: '',
		trackPaths,
		tracks: [],
	};
}

function makeTrack(path: string): MusicTrack {
	return {
		path,
		title: path.replace(/\.md$/, ''),
		artist: 'Artist',
		sourceUrl: 'https://youtube.com/watch?v=abc',
		watchUrl: 'https://youtube.com/watch?v=abc',
		videoId: 'abc',
		thumbnailUrl: 'https://img.youtube.com/vi/abc/mqdefault.jpg',
		tags: ['rock'],
	};
}

describe('resolveSelectedPlaylistPath', () => {
	it('returns configured path when it exists in playlists', () => {
		const playlists = [makePlaylist('a.md'), makePlaylist('b.md')];
		expect(resolveSelectedPlaylistPath('b.md', playlists)).toBe('b.md');
	});

	it('falls back to first playlist when configured is not found', () => {
		const playlists = [makePlaylist('a.md'), makePlaylist('b.md')];
		expect(resolveSelectedPlaylistPath('missing.md', playlists)).toBe('a.md');
	});

	it('falls back to first playlist when configured is null', () => {
		const playlists = [makePlaylist('a.md')];
		expect(resolveSelectedPlaylistPath(null, playlists)).toBe('a.md');
	});

	it('returns null for empty playlist list', () => {
		expect(resolveSelectedPlaylistPath(null, [])).toBeNull();
	});
});

describe('getPlaylistOrThrow', () => {
	it('returns playlist when found', () => {
		const playlists = [makePlaylist('a.md'), makePlaylist('b.md')];
		expect(getPlaylistOrThrow('a.md', playlists).path).toBe('a.md');
	});

	it('throws when not found', () => {
		expect(() => getPlaylistOrThrow('missing.md', [])).toThrow('Playlist not found');
	});
});

describe('toPlaylistSummary', () => {
	it('maps PlaylistNote to PlaylistSummary', () => {
		const playlist = makePlaylist('my-list.md', ['a.md', 'b.md']);
		playlist.coverUrl = 'https://example.com/cover.jpg';
		playlist.description = 'A great playlist';

		const summary = toPlaylistSummary(playlist);
		expect(summary.path).toBe('my-list.md');
		expect(summary.title).toBe('my-list');
		expect(summary.trackCount).toBe(2);
		expect(summary.coverImage).toBe('https://example.com/cover.jpg');
		expect(summary.description).toBe('A great playlist');
	});

	it('omits coverImage and description when empty', () => {
		const playlist = makePlaylist('empty.md');
		const summary = toPlaylistSummary(playlist);
		expect(summary.coverImage).toBeUndefined();
		expect(summary.description).toBeUndefined();
	});
});

describe('toPlaylistTrack', () => {
	it('maps MusicTrack to PlaylistTrack', () => {
		const track = makeTrack('song.md');
		const result = toPlaylistTrack(track);

		expect(result.path).toBe('song.md');
		expect(result.title).toBe('song');
		expect(result.artist).toBe('Artist');
		expect(result.videoId).toBe('abc');
		expect(result.tags).toEqual(['rock']);
	});
});

describe('moveItem', () => {
	it('moves an item without mutating the input', () => {
		const input = ['a', 'b', 'c'];
		expect(moveItem(input, 0, 2)).toEqual(['b', 'c', 'a']);
		expect(moveItem(input, 2, 0)).toEqual(['c', 'a', 'b']);
		expect(input).toEqual(['a', 'b', 'c']);
	});
});

describe('moveValue', () => {
	it('keeps entries added after the move started', () => {
		expect(moveValue(['a', 'b', 'c', 'new'], 'a', 2)).toEqual(['b', 'c', 'a', 'new']);
	});

	it('clamps the target and ignores missing items', () => {
		expect(moveValue(['a', 'b'], 'a', 5)).toEqual(['b', 'a']);
		expect(moveValue(['a', 'b'], 'x', 0)).toEqual(['a', 'b']);
	});
});

describe('successorAfterRemoval', () => {
	const queue = ['a', 'b', 'c'];

	it('picks the track that followed the removed one', () => {
		expect(successorAfterRemoval(queue, 'a')).toBe('b');
		expect(successorAfterRemoval(queue, 'b')).toBe('c');
	});

	it('wraps to the first track only at the end', () => {
		expect(successorAfterRemoval(queue, 'c')).toBe('a');
	});

	it('returns null when nothing is left', () => {
		expect(successorAfterRemoval(['a'], 'a')).toBeNull();
	});
});
