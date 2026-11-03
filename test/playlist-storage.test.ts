import { describe, expect, it } from 'vitest';
import { createPlaylistNoteContent, mergeTrackEntries, updatePlaylistNoteContent } from '../src/domain/playlist-storage';

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
      musicUrlProperty: 'source',
      musicThumbnailProperty: 'image',
      musicArtistProperty: 'author',
      playlistMembershipProperty: 'playlists',
      legacyPlaylistTrackProperty: 'entries',
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

describe('mergeTrackEntries', () => {
  const owned = new Set(['[[a]]', '[[b]]', '[[c]]']);
  const isOwned = (entry: string) => owned.has(entry);

  it('keeps entries the plugin does not own at their original index', () => {
    const existing = ['[[a]]', '[[missing]]', '[[b]]', 'plain text', 7, '[[c]]'];
    expect(mergeTrackEntries(existing, ['c.md', 'a.md'], isOwned))
      .toEqual(['[[c]]', '[[missing]]', '[[a]]', 'plain text', 7]);
  });

  it('does not duplicate an unresolved link that is being written', () => {
    expect(mergeTrackEntries(['[[missing]]'], ['missing.md'], isOwned)).toEqual(['[[missing]]']);
  });
});
