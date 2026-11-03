import { describe, expect, it } from 'vitest';
import {
  buildFolderOptions,
  collectPropertyKeys,
  collectPropertyValues,
  createItemFor,
} from '../src/domain/settings-options';

describe('buildFolderOptions', () => {
  it('offers the vault root first, then every folder sorted, never the empty path', () => {
    expect(buildFolderOptions(['Music/Sub', 'Inbox', '', '/', 'Music', 'Inbox'], 'Inbox')).toEqual([
      ['/', 'Vault root'],
      ['Inbox', 'Inbox'],
      ['Music', 'Music'],
      ['Music/Sub', 'Music/Sub'],
    ]);
  });

  it('keeps a saved folder that does not exist yet selectable and labelled', () => {
    expect(buildFolderOptions(['Inbox'], '90. System/Playlists')).toEqual([
      ['/', 'Vault root'],
      ['90. System/Playlists', '90. System/Playlists · will be created'],
      ['Inbox', 'Inbox'],
    ]);
  });

  it('labels the legacy empty value only while it is the saved value', () => {
    expect(buildFolderOptions(['Inbox'], '')).toEqual([
      ['/', 'Vault root'],
      ['', 'Default location (legacy)'],
      ['Inbox', 'Inbox'],
    ]);
    expect(buildFolderOptions(['Inbox'], 'Inbox').map(([value]) => value)).toEqual(['/', 'Inbox']);
  });

  it('adds nothing for the saved vault root', () => {
    expect(buildFolderOptions(['Inbox'], '/').map(([value]) => value)).toEqual(['/', 'Inbox']);
  });

  it('keeps the vault root first and plain localeCompare order for integer-like folder names', () => {
    expect(buildFolderOptions(['a', '2024', '10', '2'], '/')).toEqual([
      ['/', 'Vault root'],
      ['10', '10'],
      ['2', '2'],
      ['2024', '2024'],
      ['a', 'a'],
    ]);
  });

  it('offers a folder named __proto__ like any other, including as the saved value', () => {
    expect(buildFolderOptions(['__proto__', 'Inbox'], '__proto__')).toEqual([
      ['/', 'Vault root'],
      ['__proto__', '__proto__'],
      ['Inbox', 'Inbox'],
    ]);
    expect(buildFolderOptions([], '__proto__')).toEqual([
      ['/', 'Vault root'],
      ['__proto__', '__proto__ · will be created'],
    ]);
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
