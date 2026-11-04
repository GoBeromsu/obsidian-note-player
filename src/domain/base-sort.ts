import type { MusicTrack } from '../types/music';
import type { MarkdownNoteSnapshot } from '../types/notes';

export interface SortRule {
  readonly property: 'file.name' | 'file.ctime' | 'file.mtime' | `note.${string}`;
  readonly direction: 'ASC' | 'DESC';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSortProperty(value: unknown): value is SortRule['property'] {
  return value === 'file.name' || value === 'file.ctime' || value === 'file.mtime'
    || (typeof value === 'string' && value.startsWith('note.') && value.length > 5);
}

export function parseBaseSort(config: unknown): SortRule[] {
  if (!isRecord(config) || !Array.isArray(config.views)) return [];
  const view: unknown = config.views[0];
  if (!isRecord(view) || !Array.isArray(view.sort)) return [];
  const rules: SortRule[] = [];
  for (const entry of view.sort) {
    if (!isRecord(entry)) continue;
    const { property, direction } = entry;
    if (direction !== 'ASC' && direction !== 'DESC') continue;
    if (isSortProperty(property)) {
      rules.push({ property, direction });
    }
  }
  return rules;
}

export function sortTracks(
  tracks: readonly MusicTrack[],
  rules: readonly SortRule[],
  snapshotsByPath: ReadonlyMap<string, MarkdownNoteSnapshot>,
): MusicTrack[] {
  const effectiveRules: readonly SortRule[] = rules.length ? rules : [{ property: 'file.name', direction: 'ASC' }];
  return [...tracks].sort((left, right) => {
    for (const rule of effectiveRules) {
      const a = sortValue(snapshotsByPath.get(left.path), rule.property);
      const b = sortValue(snapshotsByPath.get(right.path), rule.property);
      const comparison = typeof a === 'number' && typeof b === 'number'
        ? a - b : String(a).localeCompare(String(b));
      if (comparison) return rule.direction === 'DESC' ? -comparison : comparison;
    }
    return 0;
  });
}

function sortValue(note: MarkdownNoteSnapshot | undefined, property: SortRule['property']): string | number {
  if (!note) return '';
  switch (property) {
    case 'file.name': return note.basename;
    case 'file.ctime': return note.ctime;
    case 'file.mtime': return note.mtime;
    default: {
      const value = note.frontmatter?.[property.slice(5)];
      if (value instanceof Date) return value.getTime();
      return typeof value === 'string' || typeof value === 'number' ? value : '';
    }
  }
}
