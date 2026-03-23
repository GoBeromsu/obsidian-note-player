import { describe, expect, it } from 'vitest';
import { createPlaylistNoteContent, updatePlaylistNoteContent } from '../src/domain/playlist-storage';

describe('playlist note serialization', () => {
  it('creates canonical frontmatter with wikilink-backed tracks', () => {
    const content = createPlaylistNoteContent({
      trackPaths: [
        '70. Collections/76. Music/널 향한 노래 Song for you.md',
        '70. Collections/76. Music/기분이 좆같을 때 듣는 노래.md',
      ],
      description: 'Liked songs',
    });

    expect(content).toContain('type: "music-playlist"');
    expect(content).toContain('tracks:');
    expect(content).toContain('- "[[70. Collections/76. Music/널 향한 노래 Song for you]]"');
    expect(content).toContain('- "[[70. Collections/76. Music/기분이 좆같을 때 듣는 노래]]"');
    expect(content).toContain('description: "Liked songs"');
  });

  it('replaces existing frontmatter while preserving body content', () => {
    const existing = `---
type: "music-playlist"
tracks:
  - "old.md"
---

# Notes
`;

    const updated = updatePlaylistNoteContent(existing, {
      trackPaths: ['new.md'],
      coverUrl: 'https://img.youtube.com/vi/demo/mqdefault.jpg',
    });

    expect(updated).toContain('- "[[new]]"');
    expect(updated).toContain('cover: "https://img.youtube.com/vi/demo/mqdefault.jpg"');
    expect(updated).toContain('# Notes');
    expect(updated).not.toContain('old.md');
  });

  it('writes configurable playlist property names', () => {
    const content = createPlaylistNoteContent({
      trackPaths: ['song.md'],
      coverUrl: 'cover.jpg',
      description: 'Custom',
    }, {
      musicUrlProperties: ['source'],
      musicThumbnailProperties: ['image'],
      musicArtistProperties: ['author'],
      playlistTrackProperty: 'entries',
      playlistDescriptionProperty: 'summary',
      playlistCoverProperty: 'artwork',
      musicNoteType: 'music',
      playlistNoteType: 'music-playlist',
    });

    expect(content).toContain('entries:');
    expect(content).toContain('- "[[song]]"');
    expect(content).toContain('summary: "Custom"');
    expect(content).toContain('artwork: "cover.jpg"');
    expect(content).not.toContain('tracks:');
  });
});
