import { describe, expect, it } from 'vitest';
import { linkDisplayText, parsePlaylistTrackReference, toObsidianWikilink } from '../src/utils/wikilink';

describe('wikilink helpers', () => {
  it.each([
    ['[[Omoide Story - Topic]]', 'Omoide Story - Topic'],
    ['[[path/X.md|Alias]]', 'Alias'],
    ['[[path/X.md#Verse]]', 'X'],
    ['[[path/X.MD]]', 'X'],
    ['[[Artists/Dr. Dre]]', 'Dr. Dre'],
    ['[[path/X|]]', 'X'],
    ['  Plain author  ', 'Plain author'],
    ['Music/Track.md', 'Music/Track.md'],
    ['AC/DC', 'AC/DC'],
    ['[[path/X', '[[path/X'],
  ])('displays %s as %s', (input, expected) => {
    expect(linkDisplayText(input)).toBe(expected);
  });
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
