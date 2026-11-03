import { describe, expect, it } from 'vitest';
import { buildMusicLibrary } from '../src/domain/library-index';
import type { MarkdownNoteSnapshot } from '../src/types/notes';

describe('buildMusicLibrary', () => {
  it('leaves the thumbnail empty for an unavailable video', () => {
    const note = (basename: string, author?: string) => ({
      path: `${basename}.md`,
      basename,
      frontmatter: { type: ['music'], source: 'https://www.youtube.com/watch?v=zzzzzzzzzz1', image: 'https://img.youtube.com/vi/zzzzzzzzzz1/mqdefault.jpg', ...(author && { author }) },
    });
    expect(buildMusicLibrary([note('zzzzzzzzzz1')]).tracks[0]?.thumbnailUrl).toBe('');
    expect(buildMusicLibrary([note('zzzzzzzzzz1', 'Someone')]).tracks[0]?.thumbnailUrl).toContain('zzzzzzzzzz1');
  });


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

  it('does not read a URL from a different property', () => {
    const notes = [{
      path: 'Music/Track.md',
      basename: 'Track',
      frontmatter: { type: 'music', youtube: 'https://www.youtube.com/watch?v=DEyzYWLvXqA' },
    }];
    expect(buildMusicLibrary(notes).tracks).toEqual([]);
  });

  it('leaves the artist empty when only another artist property has a value', () => {
    const notes = [{
      path: 'Music/Track.md',
      basename: 'Track',
      frontmatter: { type: 'music', source: 'https://www.youtube.com/watch?v=DEyzYWLvXqA', artist: 'Other artist' },
    }];
    expect(buildMusicLibrary(notes).tracks[0]?.artist).toBe('');
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
      musicUrlProperty: 'clip_url',
      musicThumbnailProperty: 'poster',
      musicArtistProperty: 'performer',
      playlistMembershipProperty: 'playlists',
      legacyPlaylistTrackProperty: 'entries',
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

describe('buildMusicLibrary heal title', () => {
  const note = (basename: string, title?: string) => ({
    path: `${basename}.md`,
    basename,
    frontmatter: { type: ['music'], source: 'https://www.youtube.com/watch?v=zzzzzzzzzz1', ...(title && { title }) },
  });

  it('reads a metadata title only for a note named after its video id', () => {
    expect(buildMusicLibrary([note('zzzzzzzzzz1', 'Real Title')]).tracks[0]?.title).toBe('Real Title');
    expect(buildMusicLibrary([note('Other name', 'Real Title')]).tracks[0]?.title).toBe('Other name');
  });
});
