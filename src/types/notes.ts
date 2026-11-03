export interface MarkdownNoteSnapshot {
  path: string;
  basename: string;
  ctime: number;
  mtime: number;
  frontmatterLinks: Record<string, string[]>;
  embeddedBases: string[];
  frontmatter?: Record<string, unknown>;
}

export interface PlaylistTrackReference {
  raw: string;
  normalized: string;
  kind: 'path' | 'wikilink';
}
