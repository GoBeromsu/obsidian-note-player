import type { PlaylistTrackReference } from '../types/notes';

/** Classifies body embeds without treating fenced or inline code examples as links. */
export function embeddedWikilinks(body: string): string[] {
  let fence = '';
  const lines: string[] = [];
  for (const line of body.split('\n')) {
    const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    const run = delimiter?.[1];
    if (fence) {
      if (run && run[0] === fence[0] && run.length >= fence.length && !delimiter?.[2]?.trim()) fence = '';
      lines.push('');
    } else if (run && (run[0] !== '`' || !delimiter?.[2]?.includes('`'))) {
      fence = run;
      lines.push('');
    } else {
      lines.push(line);
    }
  }
  const text = lines.join('\n');
  const links: string[] = [];
  let codeEnd = 0;
  for (const token of text.matchAll(/\\[\s\S]|`+|!\[\[([^\]\n]+)\]\]/g)) {
    if (token.index < codeEnd) continue;
    if (token[0].startsWith('`')) {
      const start = token.index + token[0].length;
      for (const close of text.slice(start).matchAll(/`+/g)) {
        if (close[0].length === token[0].length) {
          codeEnd = start + close.index + close[0].length;
          break;
        }
      }
    } else if (token[1]) {
      links.push(token[1].split(/[|#]/)[0]?.trim() ?? '');
    }
  }
  return links;
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
