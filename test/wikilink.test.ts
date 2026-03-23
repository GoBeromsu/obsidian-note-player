import { describe, expect, it } from 'vitest';
import { parsePlaylistTrackReference, toObsidianWikilink } from '../src/utils/wikilink';

describe('wikilink helpers', () => {
  it('formats canonical note paths as Obsidian wikilinks', () => {
    expect(toObsidianWikilink('Music/Track.md')).toBe('[[Music/Track]]');
    expect(toObsidianWikilink('Music/Track')).toBe('[[Music/Track]]');
  });

  it('parses legacy paths and wikilinks into canonical markdown paths', () => {
    expect(parsePlaylistTrackReference('Music/Track.md')).toEqual({
      raw: 'Music/Track.md',
      normalized: 'Music/Track.md',
      kind: 'path',
    });
    expect(parsePlaylistTrackReference('[[Music/Track#Section|Alias]]')).toEqual({
      raw: '[[Music/Track#Section|Alias]]',
      normalized: 'Music/Track.md',
      kind: 'wikilink',
    });
  });
});
