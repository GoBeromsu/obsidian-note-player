import type { PlaylistNote } from '../types/music';
import type { PlaylistBasesRow } from '../types/playlist-bases';
import { buildYoutubeThumbnailUrl } from '../utils/youtube';
import { isUnavailable, trackLabel } from './track-import';

export function buildPlaylistBasesRows(playlist: PlaylistNote, currentTrackPath: string | null): PlaylistBasesRow[] {
	return playlist.tracks.map((track, index) => {
		const unavailable = isUnavailable(track);
		return {
			path: track.path,
			order: String(index + 1).padStart(2, '0'),
			title: trackLabel(track),
			artist: track.artist,
			thumbnailUrl: unavailable || !track.videoId ? null : buildYoutubeThumbnailUrl(track.videoId),
			unavailable,
			current: track.path === currentTrackPath,
		};
	});
}

/** Everything that forces a rebuild. The current flag is left out so a track change only toggles classes and the highlight can animate. */
export function playlistBasesSignature(playlist: PlaylistNote, rows: readonly PlaylistBasesRow[]): string {
	const rowKeys = rows.map((row) => [row.path, row.title, row.artist, row.thumbnailUrl ?? '', row.unavailable ? '1' : '0'].join('\u0001'));
	return [playlist.path, playlist.title, ...rowKeys].join('\u0002');
}
