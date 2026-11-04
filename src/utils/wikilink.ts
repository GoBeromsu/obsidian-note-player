import type { PlaylistTrackReference } from '../types/notes';

export function linkDisplayText(input: string, barePath = false): string {
  const trimmed = input.trim();
  const wikilink = trimmed.startsWith('[[') && trimmed.endsWith(']]');
  if (!wikilink && !barePath) return trimmed;
  const [target = '', alias] = (wikilink ? trimmed.slice(2, -2) : trimmed).split('|');
  if (alias?.trim()) return alias.trim();
  const path = target.split('#')[0]?.trim() ?? '';
  return stripMarkdownExtension(path.split('/').pop() ?? path);
}

export function canonicalizeNotePath(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return '';
  }

  return trimmed.toLowerCase().endsWith('.md') ? trimmed : `${trimmed}.md`;
}

export function stripMarkdownExtension(input: string): string {
  return input.replace(/\.md$/i, '');
}

export function toObsidianWikilink(input: string): string {
  const normalized = canonicalizeNotePath(input);
  return normalized ? `[[${stripMarkdownExtension(normalized)}]]` : '';
}

export function parsePlaylistTrackReference(input: string): PlaylistTrackReference | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith('[[') && trimmed.endsWith(']]')) {
    const inner = trimmed.slice(2, -2).trim();
    if (!inner) {
      return null;
    }

    const withoutAlias = inner.split('|')[0]?.trim() ?? '';
    const withoutHeading = withoutAlias.split('#')[0]?.trim() ?? '';
    const normalized = canonicalizeNotePath(withoutHeading);

    return normalized
      ? {
          raw: trimmed,
          normalized,
          kind: 'wikilink',
        }
      : null;
  }

  const normalized = canonicalizeNotePath(trimmed);
  return normalized
    ? {
        raw: trimmed,
        normalized,
        kind: 'path',
      }
    : null;
}
