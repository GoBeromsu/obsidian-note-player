import { plural } from '../utils/plural';

export const NOTICE_CATALOG = {
	library_refreshed: { template: 'Refreshed {{tracks}} across {{playlists}}.' },
	bases_refreshed: { template: 'Refreshed {{files}} in {{folder}}.' },
	migration_already_bases: { template: 'All playlists already use Bases.' },
	migration_progress: { template: 'Converting {{name}}...' },
	migration_complete: { template: 'Converted {{playlists:playlist}}, linked {{tracks:track}}, {{missing}} missing.' },
	migration_cards_complete: { template: 'Switched {{bases:playlist base}} to the cards view.' },
	migration_failed: { template: 'Could not convert {{name}}: {{reason}}' },
	base_unreadable: { template: "Couldn't read {{name}} - check its YAML." },
	playlist_created: { template: 'Created playlist {{name}}.' },
	playlist_loaded: { template: 'Loaded playlist {{name}}.' },
	track_added: { template: 'Added {{title}} to {{playlist}}.' },
	track_removed: { template: 'Removed {{title}} from {{playlist}}.' },
	active_note_not_music: { template: 'The active note is not a music note with a playable source.' },
	active_note_not_playlist: { template: 'The active note is not a playlist note.' },
	playlist_missing: { template: 'Choose a playlist first.' },
	download_cancelled: { template: 'Download cancelled.' },
	track_already_in_playlist: { template: '{{title}} is already in {{playlist}}.' },
	invalid_youtube_url: { template: 'Not a YouTube video or playlist URL.' },
	paste_youtube_url: { template: 'Paste a YouTube video or playlist URL.' },
	tracks_imported: { template: 'Added {{tracks}} to {{playlist}}.' },
	action_succeeded: { template: '{{message}}' },
	ytdlp_unavailable: { template: 'yt-dlp is not installed. Run brew install yt-dlp, then try again.' },
	thumbnail_cache_cleared: { template: 'Thumbnail cache cleared.' },
	folder_create_failed: { template: "Couldn't create the folder {{path}}. Check the name and try again." },
	thumbnail_cache_clear_failed: { template: "Couldn't clear the thumbnail cache. Try again." },
	bases_refresh_failed: { template: "Couldn't refresh the companion Bases files. Try again." },
} as const;

export type NoticeId = keyof typeof NOTICE_CATALOG;

/** Confirmations fade fast and alike; warnings keep Obsidian's default time. */
export const SUCCESS_NOTICE_MS = 3500;
const SUCCESS_NOTICES: ReadonlySet<NoticeId> = new Set([
	'library_refreshed',
	'bases_refreshed',
	'playlist_created',
	'playlist_loaded',
	'track_added',
	'track_removed',
	'tracks_imported',
	'action_succeeded',
	'thumbnail_cache_cleared',
]);

export function noticeDuration(id: NoticeId): number | undefined {
	return SUCCESS_NOTICES.has(id) ? SUCCESS_NOTICE_MS : undefined;
}

export function renderNotice(template: string, params: Record<string, string | number> = {}): string {
	const text = template.replace(/{{\s*([\w.-]+)(?::([\w ]+))?\s*}}/g, (_match, key: string, noun: string | undefined) => {
		const value = params[key] ?? '';
		return noun && typeof value === 'number' ? plural(value, noun.trim()) : String(value);
	});
	return text;
}
