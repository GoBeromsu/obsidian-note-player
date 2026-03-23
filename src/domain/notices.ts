export const NOTICE_CATALOG = {
	library_refreshed: { template: 'Refreshed {{trackCount}} tracks across {{playlistCount}} playlists.' },
	bases_refreshed: { template: 'Refreshed {{count}} companion Bases files in {{folder}}.' },
	playlist_saved: { template: 'Saved playlist {{name}}.' },
	playlist_created: { template: 'Created playlist {{name}}.' },
	playlist_loaded: { template: 'Loaded playlist {{name}}.' },
	track_added: { template: 'Added {{title}} to {{playlist}}.' },
	track_removed: { template: 'Removed {{title}} from {{playlist}}.' },
	active_note_not_music: { template: 'The active note is not a music note with a playable source.' },
	active_note_not_playlist: { template: 'The active note is not a playlist note.' },
	playlist_missing: { template: 'Choose a playlist first.' },
} as const;
