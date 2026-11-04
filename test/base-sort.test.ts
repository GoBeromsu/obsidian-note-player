import { describe, expect, it } from 'vitest';
import { parseBaseSort } from '../src/domain/base-sort';

describe('parseBaseSort', () => {
  it('reads only the first view regardless of its type', () => {
    expect(parseBaseSort({ views: [
      { type: 'cards', sort: [
        { property: 'note.date_created', direction: 'DESC' },
        { property: 'formula.x', direction: 'ASC' },
        { property: 'file.mtime', direction: 'ASC' },
      ] },
      { type: 'note-player', sort: [{ property: 'file.ctime', direction: 'ASC' }] },
    ] })).toEqual([
      { property: 'note.date_created', direction: 'DESC' },
      { property: 'file.mtime', direction: 'ASC' },
    ]);
  });

  it('does not borrow sorting from a later view when the first has none', () => {
    expect(parseBaseSort({ views: [
      { type: 'cards' },
      { type: 'note-player', sort: [{ property: 'file.name', direction: 'DESC' }] },
    ] })).toEqual([]);
  });

  it.each([
    undefined, null, false, 1, 'config', [],
    {}, { views: null }, { views: [null, 'view'] },
    { views: [{ type: 'note-player', sort: 'sort' }] },
    { views: [{ type: 'note-player', sort: [
      null, 'rule', {}, { property: 'file.name' }, { direction: 'ASC' },
      { property: 'file.name', direction: 'desc' }, { property: 'note.', direction: 'ASC' },
    ] }] },
  ])('ignores malformed config or sort entries %j', (config) => {
    expect(parseBaseSort(config)).toEqual([]);
  });
});
