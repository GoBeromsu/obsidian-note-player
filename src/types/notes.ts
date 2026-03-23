export interface MarkdownNoteSnapshot {
  path: string;
  basename: string;
  frontmatter?: Record<string, unknown>;
}

export interface PlaylistTrackReference {
  raw: string;
  normalized: string;
  kind: 'path' | 'wikilink';
}
