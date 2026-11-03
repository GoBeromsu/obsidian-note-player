import { describe, expect, it } from 'vitest';
import { buildPlaylistBasesRows, playlistBasesSignature } from '../src/domain/playlist-bases';
import type { MusicTrack, PlaylistNote } from '../src/types/music';

function makeTrack(path: string, overrides: Partial<MusicTrack> = {}): MusicTrack {
	const videoId = overrides.videoId ?? 'abc123';
	return {
		path,
		title: path.replace(/\.md$/, ''),
		artist: 'Artist',
		sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
		watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
		videoId,
		thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
		tags: [],
		...overrides,
	};
}

function makePlaylist(tracks: MusicTrack[]): PlaylistNote {
	return {
		path: 'Playlists/Mix.md',
		basePath: 'Playlists/Mix.base',
		title: 'Mix',
		coverUrl: '',
		description: '',
		trackPaths: tracks.map((track) => track.path),
		tracks,
	};
}

describe('buildPlaylistBasesRows', () => {
	it('keeps playlist order with zero-padded numbers and the fixed thumbnail URL', () => {
		const rows = buildPlaylistBasesRows(makePlaylist([makeTrack('b.md', { videoId: 'vidB' }), makeTrack('a.md', { videoId: 'vidA' })]), null);
		expect(rows.map((row) => [row.order, row.path, row.thumbnailUrl])).toEqual([
			['01', 'b.md', 'https://i.ytimg.com/vi/vidB/hqdefault.jpg'],
			['02', 'a.md', 'https://i.ytimg.com/vi/vidA/hqdefault.jpg'],
		]);
		expect(rows.every((row) => !row.current && !row.unavailable)).toBe(true);
	});

	it('marks only the row whose path is the current track', () => {
		const rows = buildPlaylistBasesRows(makePlaylist([makeTrack('a.md'), makeTrack('b.md')]), 'b.md');
		expect(rows.map((row) => row.current)).toEqual([false, true]);
	});

	it('marks nothing when the current track is not a member', () => {
		const rows = buildPlaylistBasesRows(makePlaylist([makeTrack('a.md')]), 'elsewhere.md');
		expect(rows.map((row) => row.current)).toEqual([false]);
	});

	it('labels unavailable videos and drops their thumbnail', () => {
		const [row] = buildPlaylistBasesRows(makePlaylist([makeTrack('xyz.md', { title: 'xyz', artist: '', videoId: 'xyz' })]), null);
		expect(row).toMatchObject({ title: 'Unavailable video', unavailable: true, thumbnailUrl: null, artist: '' });
	});

	it('uses the injected thumbnail source for available videos only', () => {
		const asked: string[] = [];
		const rows = buildPlaylistBasesRows(
			makePlaylist([makeTrack('a.md', { videoId: 'vidA' }), makeTrack('xyz.md', { title: 'xyz', artist: '', videoId: 'xyz' })]),
			null,
			(videoId) => { asked.push(videoId); return `app://cache/${videoId}.jpg`; },
		);
		expect(rows.map((row) => row.thumbnailUrl)).toEqual(['app://cache/vidA.jpg', null]);
		expect(asked).toEqual(['vidA']);
	});

	it('drops the thumbnail when a track has no video id', () => {
		const [row] = buildPlaylistBasesRows(makePlaylist([makeTrack('local.md', { videoId: '' })]), null);
		expect(row?.thumbnailUrl).toBeNull();
		expect(row?.unavailable).toBe(false);
	});

	it('returns no rows for a playlist with zero tracks', () => {
		expect(buildPlaylistBasesRows(makePlaylist([]), 'a.md')).toEqual([]);
	});
});

describe('playlistBasesSignature', () => {
	const playlist = makePlaylist([makeTrack('a.md'), makeTrack('b.md')]);

	it('ignores which row is current', () => {
		const before = playlistBasesSignature(playlist, buildPlaylistBasesRows(playlist, 'a.md'));
		const after = playlistBasesSignature(playlist, buildPlaylistBasesRows(playlist, 'b.md'));
		expect(after).toBe(before);
	});

	it('changes when a row title, the order, or the playlist changes', () => {
		const base = playlistBasesSignature(playlist, buildPlaylistBasesRows(playlist, null));
		const renamed = makePlaylist([makeTrack('a.md', { title: 'Renamed' }), makeTrack('b.md')]);
		const reordered = makePlaylist([makeTrack('b.md'), makeTrack('a.md')]);
		const moved = { ...playlist, path: 'Playlists/Other.md' };
		expect(playlistBasesSignature(renamed, buildPlaylistBasesRows(renamed, null))).not.toBe(base);
		expect(playlistBasesSignature(reordered, buildPlaylistBasesRows(reordered, null))).not.toBe(base);
		expect(playlistBasesSignature(moved, buildPlaylistBasesRows(moved, null))).not.toBe(base);
	});
});
