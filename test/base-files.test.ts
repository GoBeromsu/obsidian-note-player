import { describe, expect, it } from 'vitest';
import { buildCompanionBaseFiles, getCompanionBaseFolder } from '../src/domain/base-files';

describe('companion base files', () => {
  it('places base files beside the playlist folder by default', () => {
    expect(getCompanionBaseFolder('90. System/Playlists')).toBe('90. System');
    expect(getCompanionBaseFolder('Playlists')).toBe('Playlists');
  });

  it('builds deterministic base files from configured property mapping', () => {
    const files = buildCompanionBaseFiles('90. System/Playlists', {
      musicUrlProperties: ['clip_url', 'source'],
      musicThumbnailProperties: ['poster'],
      musicArtistProperties: ['performer'],
      playlistTrackProperty: 'entries',
      playlistDescriptionProperty: 'summary',
      playlistCoverProperty: 'artwork',
      musicNoteType: 'music',
      playlistNoteType: 'music-playlist',
    });

    expect(files).toEqual([
      expect.objectContaining({
        path: '90. System/Music.base',
      }),
      expect.objectContaining({
        path: '90. System/Playlists.base',
      }),
    ]);
	expect(files[0]?.content).toContain('- poster');
	expect(files[0]?.content).toContain('- performer');
	expect(files[0]?.content).toContain('- clip_url');
	expect(files[0]?.content).toContain('name: "Table"');
	expect(files[1]?.content).toContain('- entries');
	expect(files[1]?.content).toContain('- summary');
	expect(files[1]?.content).toContain('- artwork');
	expect(files[1]?.content).toContain('track_count: "entries.length"');
	expect(files[1]?.content).toContain('- formula.track_count');
	expect(files[1]?.content).toContain('name: "Cards"');
  });
});
