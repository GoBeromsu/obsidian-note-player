import { describe, expect, it } from 'vitest';
import {
  buildFolderOptions,
  collectPropertyKeys,
  collectPropertyValues,
  createItemFor,
} from '../src/domain/settings-options';

describe('buildFolderOptions', () => {
  it('offers the vault root first, then every folder sorted, never the empty path', () => {
    const options = buildFolderOptions(['Music/Sub', 'Inbox', '', '/', 'Music', 'Inbox'], 'Inbox');
    expect(Object.entries(options)).toEqual([
      ['/', 'Vault root'],
      ['Inbox', 'Inbox'],
      ['Music', 'Music'],
      ['Music/Sub', 'Music/Sub'],
    ]);
  });

  it('keeps a saved folder that does not exist yet selectable and labelled', () => {
    const options = buildFolderOptions(['Inbox'], '90. System/Playlists');
    expect(Object.entries(options)).toEqual([
      ['/', 'Vault root'],
      ['90. System/Playlists', '90. System/Playlists · will be created'],
      ['Inbox', 'Inbox'],
    ]);
  });

  it('labels the legacy empty value only while it is the saved value', () => {
    expect(Object.entries(buildFolderOptions(['Inbox'], ''))).toEqual([
      ['/', 'Vault root'],
      ['', 'Default location (legacy)'],
      ['Inbox', 'Inbox'],
    ]);
    expect(Object.keys(buildFolderOptions(['Inbox'], 'Inbox'))).toEqual(['/', 'Inbox']);
  });

  it('adds nothing for the saved vault root', () => {
    expect(Object.keys(buildFolderOptions(['Inbox'], '/'))).toEqual(['/', 'Inbox']);
  });
});

describe('collectPropertyKeys', () => {
  it('unions keys across notes, drops position, and sorts them', () => {
    expect(collectPropertyKeys([
      { type: 'music', source: 'x', position: {} },
      undefined,
      { performer: 'a', type: 'music' },
      {},
    ])).toEqual(['performer', 'source', 'type']);
  });

  it('keeps unusual keys verbatim', () => {
    const long = 'k'.repeat(300);
    expect(collectPropertyKeys([{ 'my prop': 1, '가수': 2, [long]: 3 }])).toEqual([long, 'my prop', '가수']);
  });

  it('returns nothing for a vault without frontmatter', () => {
    expect(collectPropertyKeys([undefined, undefined])).toEqual([]);
  });
});

describe('collectPropertyValues', () => {
  it('lists distinct trimmed string values from scalars and lists', () => {
    expect(collectPropertyValues([
      { type: ' music ' },
      { type: ['music-playlist', 'music', 7, ''] },
      { type: 42 },
      undefined,
      { other: 'note' },
    ], 'type')).toEqual(['music', 'music-playlist']);
  });
});

describe('createItemFor', () => {
  it.each([
    ['', null],
    ['   ', null],
    ['performer', null],
    [' performer ', null],
    ['Performer', 'Performer'],
    [' mood ', 'mood'],
  ])('maps the query %j to the create item %j', (query, expected) => {
    expect(createItemFor(query, ['performer', 'source'])).toBe(expected);
  });
});
