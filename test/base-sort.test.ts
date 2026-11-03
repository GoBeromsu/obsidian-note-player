import { describe, expect, it } from 'vitest';
import { parseNotePlayerSort } from '../src/domain/base-sort';

describe('parseNotePlayerSort', () => {
  it('reads only the first Note Player view and ignores unsupported properties', () => {
    expect(parseNotePlayerSort({ views: [
      { type: 'table', sort: [{ property: 'file.name', direction: 'DESC' }] },
      { type: 'note-player', sort: [
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

  it.each([
    undefined, null, false, 1, 'config', [],
    {}, { views: null }, { views: [null, 'view'] },
    { views: [{ type: 'note-player', sort: 'sort' }] },
    { views: [{ type: 'note-player', sort: [
      null, 'rule', {}, { property: 'file.name' }, { direction: 'ASC' },
      { property: 'file.name', direction: 'desc' }, { property: 'note.', direction: 'ASC' },
    ] }] },
  ])('ignores malformed config or sort entries %j', (config) => {
    expect(parseNotePlayerSort(config)).toEqual([]);
  });
});
