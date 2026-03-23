import { describe, expect, it } from 'vitest';
import { buildMusicLibrary } from '../src/domain/library-index';
import type { MarkdownNoteSnapshot } from '../src/types/notes';

describe('buildMusicLibrary', () => {
  it('indexes music notes and resolves playlist tracks from paths and wikilinks', () => {
    const notes: MarkdownNoteSnapshot[] = [
      {
        path: '70. Collections/76. Music/널 향한 노래 Song for you.md',
        basename: '널 향한 노래 Song for you',
        frontmatter: {
          type: ['music'],
          author: 'ANOINTING',
          source: 'https://www.youtube.com/watch?v=DEyzYWLvXqA',
          image: 'https://img.youtube.com/vi/DEyzYWLvXqA/mqdefault.jpg',
          tags: ['music', 'music/liked'],
        },
      },
      {
        path: '70. Collections/76. Music/기분이 좆같을 때 듣는 노래.md',
        basename: '기분이 좆같을 때 듣는 노래',
        frontmatter: {
          type: ['music'],
          author: '무디MUDI',
          source: 'https://www.youtube.com/watch?v=Zs3CIgFET_Y',
        },
      },
      {
        path: '90. System/Playlists/Favorites.md',
        basename: 'Favorites',
        frontmatter: {
          type: ['music-playlist'],
          tracks: [
            '70. Collections/76. Music/널 향한 노래 Song for you.md',
            '[[70. Collections/76. Music/기분이 좆같을 때 듣는 노래]]',
          ],
          description: 'Current heavy rotation',
        },
      },
    ];

    const snapshot = buildMusicLibrary(notes);

    expect(snapshot.tracks).toHaveLength(2);
    expect(snapshot.playlists).toHaveLength(1);
    expect(snapshot.playlists[0]?.trackPaths).toEqual([
      '70. Collections/76. Music/널 향한 노래 Song for you.md',
      '70. Collections/76. Music/기분이 좆같을 때 듣는 노래.md',
    ]);
    expect(snapshot.playlists[0]?.tracks.map((track) => track.artist)).toEqual([
      'ANOINTING',
      '무디MUDI',
    ]);
  });

  it('ignores notes that are missing youtube urls', () => {
    const notes: MarkdownNoteSnapshot[] = [
      {
        path: 'Music/No Source.md',
        basename: 'No Source',
        frontmatter: {
          type: ['music'],
        },
      },
    ];

    expect(buildMusicLibrary(notes).tracks).toHaveLength(0);
  });

  it('supports custom property mapping for music and playlist notes', () => {
    const notes: MarkdownNoteSnapshot[] = [
      {
        path: 'Music/Custom Track.md',
        basename: 'Custom Track',
        frontmatter: {
          type: ['music'],
          clip_url: 'https://www.youtube.com/watch?v=DEyzYWLvXqA',
          poster: 'https://img.youtube.com/vi/DEyzYWLvXqA/mqdefault.jpg',
          performer: 'Custom Artist',
        },
      },
      {
        path: 'Playlists/Custom.md',
        basename: 'Custom',
        frontmatter: {
          type: ['music-playlist'],
          entries: ['Music/Custom Track.md'],
          summary: 'Custom schema playlist',
          artwork: 'https://img.youtube.com/vi/DEyzYWLvXqA/mqdefault.jpg',
        },
      },
    ];

    const snapshot = buildMusicLibrary(notes, {
      musicUrlProperties: ['clip_url'],
      musicThumbnailProperties: ['poster'],
      musicArtistProperties: ['performer'],
      playlistTrackProperty: 'entries',
      playlistDescriptionProperty: 'summary',
      playlistCoverProperty: 'artwork',
      musicNoteType: 'music',
      playlistNoteType: 'music-playlist',
    });

    expect(snapshot.tracks[0]?.artist).toBe('Custom Artist');
    expect(snapshot.playlists[0]?.description).toBe('Custom schema playlist');
    expect(snapshot.playlists[0]?.coverUrl).toContain('/mqdefault.jpg');
  });
});
