import { describe, expect, it } from 'vitest';
import {
  buildFolderOptions,
  countNotesByFolder,
  isCreatableFolderPath,
  collectPropertyKeys,
  collectPropertyValues,
  createItemFor,
} from '../src/domain/settings-options';

describe('buildFolderOptions', () => {
  const none = new Map<string, number>();
  const values = (paths: string[], keep: string[] = []) => buildFolderOptions(paths, none, keep).map(({ value }) => value);

  it('offers the vault root first, then every folder sorted, never the empty path', () => {
    expect(values(['Music/Sub', 'Inbox', '', '/', 'Music', 'Inbox', '10', '2'])).toEqual(['/', '10', '2', 'Inbox', 'Music', 'Music/Sub']);
    expect(buildFolderOptions([], none, [])[0]).toEqual({ value: '/', label: 'Vault root', count: 0 });
  });

  it('marks kept folders that do not exist yet, once', () => {
    const options = buildFolderOptions(['Inbox'], new Map([['Inbox', 2]]), ['90. System', '90. System', 'Inbox', '/', '']);
    expect(options).toEqual([
      { value: '/', label: 'Vault root', count: 0 },
      { value: '90. System', label: '90. System', count: 0, hint: 'Will be created' },
      { value: 'Inbox', label: 'Inbox', count: 2 },
    ]);
  });
});

describe('collectPropertyKeys', () => {
  it('ranks keys by usage, then name, and drops position', () => {
    expect(collectPropertyKeys([
      { type: 'music', source: 'x', position: {} },
      undefined,
      { performer: 'a', type: 'music' },
      {},
    ]).map(({ value, count }) => [value, count])).toEqual([['type', 2], ['performer', 1], ['source', 1]]);
  });

  it('keeps unusual keys verbatim', () => {
    const long = 'k'.repeat(300);
    expect(collectPropertyKeys([{ 'my prop': 1, '가수': 2, [long]: 3 }]).map(({ value }) => value)).toEqual([long, 'my prop', '가수']);
  });

  it('samples the first printable value, skipping empty and nested ones', () => {
    const [option] = collectPropertyKeys([{ a: null }, { a: { nested: 1 } }, { a: ['', 'first'] }, { a: 'later' }]);
    expect(option).toEqual({ value: 'a', count: 4, sample: 'first' });
    expect(collectPropertyKeys([{ n: 0 }, { b: false }]).map(({ sample }) => sample)).toEqual(['false', '0']);
  });

  it('returns nothing for a vault without frontmatter', () => {
    expect(collectPropertyKeys([undefined, undefined])).toEqual([]);
  });
});

describe('collectPropertyValues', () => {
  it('counts distinct trimmed string values per note, most used first', () => {
    expect(collectPropertyValues([
      { type: ' music ' },
      { type: ['music-playlist', 'music', 'music', 7, ''] },
      { type: 42 },
      undefined,
      { other: 'note' },
    ], 'type')).toEqual([{ value: 'music', count: 2 }, { value: 'music-playlist', count: 1 }]);
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

describe('folder helpers', () => {
  it('counts notes in a folder and its ancestors', () => {
    expect([...countNotesByFolder(['a/b/x.md', 'a/y.md', 'z.md'])]).toEqual([['/', 3], ['a', 2], ['a/b', 1]]);
  });

  it('rejects hidden, escaping and non-portable paths', () => {
    expect(['Music/New', '.obsidian/x', 'a/../b', 'a:b', 'a#b'].map(isCreatableFolderPath)).toEqual([true, false, false, false, false]);
  });
});
