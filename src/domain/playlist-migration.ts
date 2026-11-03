import type { YoutubePlaylistPropertyMapping } from '../types/settings';
import { hasType } from '../utils/frontmatter';
import { parsePlaylistTrackReference } from '../utils/wikilink';
import { LEGACY_TRACKS_KEY } from './config';

export interface MigrationPlaylistInput {
  readonly path: string;
  readonly basename: string;
  readonly folder: string;
  readonly frontmatter: Record<string, unknown> | null | undefined;
  // Keep positions aligned with resolvedTrackPaths, including malformed entries.
  readonly trackRefs: readonly unknown[];
  readonly resolvedTrackPaths: readonly (string | null)[];
  readonly embeddedBases: readonly string[];
}

export interface PlaylistMigrationInput {
  readonly playlists: readonly MigrationPlaylistInput[];
  readonly trackMembership: ReadonlyMap<string, readonly string[]>;
  readonly mapping: YoutubePlaylistPropertyMapping;
  readonly existingPaths: ReadonlySet<string>;
}

export interface PlaylistMigration {
  readonly notePath: string;
  readonly basePath: string;
  readonly createBase: boolean;
  readonly appendEmbed: boolean;
  readonly membershipAdds: string[];
  readonly renameLegacyKey: boolean;
  readonly missing: string[];
}

export interface PlaylistMigrationPlan {
  readonly playlists: PlaylistMigration[];
  readonly invalid: string[];
  readonly totals: {
    readonly playlists: number;
    readonly createBases: number;
    readonly appendEmbeds: number;
    readonly membershipAdds: number;
    readonly renameLegacyKeys: number;
    readonly missing: number;
    readonly invalid: number;
  };
}

export function planPlaylistMigration(input: PlaylistMigrationInput): PlaylistMigrationPlan {
  // This fallback is only the legacy input key, never a live mapping read.
  const legacyKey = input.mapping.legacyPlaylistTrackProperty ?? LEGACY_TRACKS_KEY;
  const reservedPaths = new Set(input.existingPaths);
  const playlists: PlaylistMigration[] = [];
  const invalid: string[] = [];

  for (const note of input.playlists) {
    const frontmatter = note.frontmatter;
    if (!frontmatter || !hasType(frontmatter, input.mapping.playlistNoteType)) {
      continue;
    }

    const hasLegacyKey = Object.hasOwn(frontmatter, legacyKey);
    if (hasLegacyKey && !Array.isArray(frontmatter[legacyKey])) {
      invalid.push(note.path);
      continue;
    }
    if (!hasLegacyKey && !Array.isArray(frontmatter.tracks_legacy)) {
      continue;
    }

    const embeddedBase = note.embeddedBases[0];
    const folder = note.folder === '/' || note.folder === '' ? '' : `${note.folder}/`;
    const stem = `${folder}${note.basename}`;
    let basePath = embeddedBase ?? `${stem}.base`;
    if (!embeddedBase) {
      let suffix = 1;
      while (reservedPaths.has(basePath)) {
        basePath = `${stem} ${suffix++}.base`;
      }
    }
    reservedPaths.add(basePath);

    const membershipAdds = new Set<string>();
    const missing = new Set<string>();
    for (const [index, raw] of note.trackRefs.entries()) {
      if (typeof raw !== 'string' || !parsePlaylistTrackReference(raw)) {
        continue;
      }
      const trackPath = note.resolvedTrackPaths[index];
      if (!trackPath) {
        missing.add(raw.trim());
      } else if (!input.trackMembership.get(trackPath)?.includes(note.path)) {
        membershipAdds.add(trackPath);
      }
    }

    playlists.push({
      notePath: note.path,
      basePath,
      createBase: embeddedBase === undefined,
      appendEmbed: embeddedBase === undefined,
      membershipAdds: [...membershipAdds],
      renameLegacyKey: hasLegacyKey,
      missing: [...missing],
    });
  }

  return {
    playlists,
    invalid,
    totals: {
      playlists: playlists.filter((playlist) =>
        playlist.createBase || playlist.appendEmbed || playlist.renameLegacyKey
        || playlist.membershipAdds.length > 0).length,
      createBases: playlists.filter((playlist) => playlist.createBase).length,
      appendEmbeds: playlists.filter((playlist) => playlist.appendEmbed).length,
      membershipAdds: playlists.reduce((count, playlist) => count + playlist.membershipAdds.length, 0),
      renameLegacyKeys: playlists.filter((playlist) => playlist.renameLegacyKey).length,
      missing: playlists.reduce((count, playlist) => count + playlist.missing.length, 0),
      invalid: invalid.length,
    },
  };
}
