import { describe, it, expect } from 'vitest';
import { PlaybackStateManager } from '../src/domain/playback-state';
import type { PlaylistTrack } from '../src/types/view';
import type { MusicTrack } from '../src/types/music';

function makeTrack(path: string): MusicTrack {
	return {
		path,
		title: path,
		artist: '',
		sourceUrl: '',
		watchUrl: '',
		embedUrl: '',
		videoId: '',
		thumbnailUrl: '',
		imageUrl: '',
		tags: [],
	};
}

function makePlaylistTrack(path: string): PlaylistTrack {
	return {
		path,
		title: path,
		artist: '',
		sourceUrl: '',
		videoId: '',
		embedUrl: '',
		thumbnailUrl: '',
		tags: [],
	};
}

describe('PlaybackStateManager', () => {
	describe('play', () => {
		it('sets currentTrackPath when track exists', () => {
			const mgr = new PlaybackStateManager();
			mgr.play('a.md', [makeTrack('a.md'), makeTrack('b.md')]);
			expect(mgr.currentTrackPath).toBe('a.md');
		});

		it('throws when track not found', () => {
			const mgr = new PlaybackStateManager();
			expect(() => mgr.play('missing.md', [makeTrack('a.md')])).toThrow('Track not found');
		});
	});

	describe('next', () => {
		it('advances to next track', () => {
			const mgr = new PlaybackStateManager();
			const queue = [makePlaylistTrack('a.md'), makePlaylistTrack('b.md'), makePlaylistTrack('c.md')];
			mgr.currentTrackPath = 'a.md';

			expect(mgr.next(queue)).toBe(true);
			expect(mgr.currentTrackPath).toBe('b.md');
		});

		it('returns false at end of queue', () => {
			const mgr = new PlaybackStateManager();
			const queue = [makePlaylistTrack('a.md'), makePlaylistTrack('b.md')];
			mgr.currentTrackPath = 'b.md';

			expect(mgr.next(queue)).toBe(false);
			expect(mgr.currentTrackPath).toBe('b.md');
		});

		it('selects first track when no current track', () => {
			const mgr = new PlaybackStateManager();
			const queue = [makePlaylistTrack('a.md'), makePlaylistTrack('b.md')];

			expect(mgr.next(queue)).toBe(true);
			expect(mgr.currentTrackPath).toBe('a.md');
		});

		it('returns false on empty queue', () => {
			const mgr = new PlaybackStateManager();
			expect(mgr.next([])).toBe(false);
		});
	});

	describe('previous', () => {
		it('goes to previous track', () => {
			const mgr = new PlaybackStateManager();
			const queue = [makePlaylistTrack('a.md'), makePlaylistTrack('b.md'), makePlaylistTrack('c.md')];
			mgr.currentTrackPath = 'c.md';

			expect(mgr.previous(queue)).toBe(true);
			expect(mgr.currentTrackPath).toBe('b.md');
		});

		it('returns false at start of queue', () => {
			const mgr = new PlaybackStateManager();
			const queue = [makePlaylistTrack('a.md'), makePlaylistTrack('b.md')];
			mgr.currentTrackPath = 'a.md';

			expect(mgr.previous(queue)).toBe(false);
			expect(mgr.currentTrackPath).toBe('a.md');
		});

		it('selects first track when no current track', () => {
			const mgr = new PlaybackStateManager();
			const queue = [makePlaylistTrack('a.md')];

			expect(mgr.previous(queue)).toBe(true);
			expect(mgr.currentTrackPath).toBe('a.md');
		});

		it('returns false on empty queue', () => {
			const mgr = new PlaybackStateManager();
			expect(mgr.previous([])).toBe(false);
		});
	});

	describe('validateCurrent', () => {
		it('clears currentTrackPath if track removed', () => {
			const mgr = new PlaybackStateManager();
			mgr.currentTrackPath = 'removed.md';
			mgr.validateCurrent([makeTrack('a.md')]);
			expect(mgr.currentTrackPath).toBeNull();
		});

		it('keeps currentTrackPath if track still exists', () => {
			const mgr = new PlaybackStateManager();
			mgr.currentTrackPath = 'a.md';
			mgr.validateCurrent([makeTrack('a.md'), makeTrack('b.md')]);
			expect(mgr.currentTrackPath).toBe('a.md');
		});

		it('does nothing when no current track', () => {
			const mgr = new PlaybackStateManager();
			mgr.validateCurrent([makeTrack('a.md')]);
			expect(mgr.currentTrackPath).toBeNull();
		});
	});

	describe('resolveCurrentTrack', () => {
		const toPlaylistTrack = (t: MusicTrack): PlaylistTrack => ({
			path: t.path,
			title: t.title,
			artist: t.artist,
			sourceUrl: t.sourceUrl,
			videoId: t.videoId,
			embedUrl: t.embedUrl,
			thumbnailUrl: t.thumbnailUrl,
			tags: t.tags,
		});

		it('returns null when no current track', () => {
			const mgr = new PlaybackStateManager();
			expect(mgr.resolveCurrentTrack([], [], toPlaylistTrack)).toBeNull();
		});

		it('finds track in queue first', () => {
			const mgr = new PlaybackStateManager();
			mgr.currentTrackPath = 'a.md';
			const queue = [makePlaylistTrack('a.md')];
			const result = mgr.resolveCurrentTrack(queue, [], toPlaylistTrack);
			expect(result?.path).toBe('a.md');
		});

		it('falls back to library if not in queue', () => {
			const mgr = new PlaybackStateManager();
			mgr.currentTrackPath = 'b.md';
			const library = [makeTrack('b.md')];
			const result = mgr.resolveCurrentTrack([], library, toPlaylistTrack);
			expect(result?.path).toBe('b.md');
		});

		it('returns null if track not found anywhere', () => {
			const mgr = new PlaybackStateManager();
			mgr.currentTrackPath = 'missing.md';
			expect(mgr.resolveCurrentTrack([], [], toPlaylistTrack)).toBeNull();
		});
	});
});
