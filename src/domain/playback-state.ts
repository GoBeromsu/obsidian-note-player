import type { PlaylistTrack } from '../types/view';
import type { MusicTrack } from '../types/music';

export class PlaybackStateManager {
	currentTrackPath: string | null = null;

	play(path: string, tracks: MusicTrack[]): void {
		const track = tracks.find((entry) => entry.path === path);
		if (!track) {
			throw new Error(`Track not found: ${path}`);
		}
		this.currentTrackPath = path;
	}

	next(queue: PlaylistTrack[]): boolean {
		if (queue.length === 0) return false;

		if (!this.currentTrackPath) {
			this.currentTrackPath = queue[0].path;
			return true;
		}

		const currentIndex = queue.findIndex((track) => track.path === this.currentTrackPath);
		if (currentIndex < 0 || currentIndex >= queue.length - 1) return false;

		this.currentTrackPath = queue[currentIndex + 1].path;
		return true;
	}

	previous(queue: PlaylistTrack[]): boolean {
		if (queue.length === 0) return false;

		if (!this.currentTrackPath) {
			this.currentTrackPath = queue[0].path;
			return true;
		}

		const currentIndex = queue.findIndex((track) => track.path === this.currentTrackPath);
		if (currentIndex <= 0) return false;

		this.currentTrackPath = queue[currentIndex - 1].path;
		return true;
	}

	validateCurrent(tracks: MusicTrack[]): void {
		if (this.currentTrackPath && !tracks.some((track) => track.path === this.currentTrackPath)) {
			this.currentTrackPath = null;
		}
	}

	resolveCurrentTrack(
		queue: PlaylistTrack[],
		library: MusicTrack[],
		toPlaylistTrack: (track: MusicTrack) => PlaylistTrack,
	): PlaylistTrack | null {
		if (!this.currentTrackPath) return null;

		const queuedTrack = queue.find((track) => track.path === this.currentTrackPath);
		if (queuedTrack) return queuedTrack;

		const libraryTrack = library.find((track) => track.path === this.currentTrackPath);
		if (libraryTrack) return toPlaylistTrack(libraryTrack);

		return null;
	}
}
