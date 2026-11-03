import { describe, expect, it } from 'vitest';
import { DEFAULT_PROPERTY_MAPPING } from '../src/domain/config';
import {
  planPlaylistMigration,
  type MigrationPlaylistInput,
  type PlaylistMigrationInput,
} from '../src/domain/playlist-migration';

function playlist(overrides: Partial<MigrationPlaylistInput> = {}): MigrationPlaylistInput {
  return {
    path: 'Music/노동요.md',
    basename: '노동요',
    folder: 'Music',
    frontmatter: { type: 'music-playlist', tracks: ['[[Song]]'] },
    trackRefs: ['[[Song]]'],
    resolvedTrackPaths: ['Music/Song.md'],
    embeddedBases: [],
    ...overrides,
  };
}

function input(overrides: Partial<PlaylistMigrationInput> = {}): PlaylistMigrationInput {
  return {
    playlists: [playlist()],
    trackMembership: new Map(),
    mapping: DEFAULT_PROPERTY_MAPPING,
    existingPaths: new Set(['Music/노동요.md', 'Music/Song.md']),
    ...overrides,
  };
}

describe('planPlaylistMigration', () => {
  it('plans a fresh Korean playlist without changing its inputs', () => {
    const source = input();
    const before = structuredClone(source);

    const plan = planPlaylistMigration(source);

    expect(plan).toEqual({
      playlists: [{
        notePath: 'Music/노동요.md',
        basePath: 'Music/노동요.base',
        createBase: true,
        appendEmbed: true,
        membershipAdds: ['Music/Song.md'],
        renameLegacyKey: true,
        missing: [],
      }],
      invalid: [],
      totals: {
        playlists: 1, createBases: 1, appendEmbeds: 1, membershipAdds: 1,
        renameLegacyKeys: 1, missing: 0, invalid: 0,
      },
    });
    expect(source).toEqual(before);
  });

  it('produces a no-op after applying the first plan', () => {
    const source = input();
    const first = planPlaylistMigration(source).playlists[0];
    expect(first).toBeDefined();
    if (!first) {
      throw new Error('Expected migration');
    }
    const postState = input({
      playlists: [playlist({
        frontmatter: { type: 'music-playlist', tracks_legacy: ['[[Song]]'] },
        embeddedBases: [first.basePath],
      })],
      existingPaths: new Set([...source.existingPaths, first.basePath]),
      trackMembership: new Map(first.membershipAdds.map((path) => [path, [first.notePath]])),
    });

    const second = planPlaylistMigration(postState);

    expect(second.playlists).toEqual([{
      notePath: 'Music/노동요.md', basePath: 'Music/노동요.base',
      createBase: false, appendEmbed: false, membershipAdds: [],
      renameLegacyKey: false, missing: [],
    }]);
    expect(second.totals).toEqual({
      playlists: 0, createBases: 0, appendEmbeds: 0, membershipAdds: 0,
      renameLegacyKeys: 0, missing: 0, invalid: 0,
    });
  });

  it('reports unresolved references while retaining resolved members', () => {
    const plan = planPlaylistMigration(input({
      playlists: [playlist({
        trackRefs: ['[[Song|Alias]]', '[[Missing#Verse]]'],
        resolvedTrackPaths: ['Music/Song.md', null],
      })],
    }));

    expect(plan.playlists[0]?.missing).toEqual(['[[Missing#Verse]]']);
    expect(plan.playlists[0]?.membershipAdds).toEqual(['Music/Song.md']);
    expect(plan.totals.missing).toBe(1);
  });

  it('reserves unique paths without claiming unrelated existing bases', () => {
    const source = input({
      playlists: [playlist(), playlist({ path: 'Music/Other.md' })],
      existingPaths: new Set(['Music/노동요.base', 'Music/노동요 1.base']),
    });

    const plan = planPlaylistMigration(source);

    expect(plan.playlists.map((entry) => entry.basePath))
      .toEqual(['Music/노동요 2.base', 'Music/노동요 3.base']);
    expect(plan.totals.createBases).toBe(2);
  });

  it('reuses an embedded base even when its name differs', () => {
    const plan = planPlaylistMigration(input({
      playlists: [playlist({ embeddedBases: ['Bases/Existing.base'] })],
    }));

    expect(plan.playlists[0]).toMatchObject({
      basePath: 'Bases/Existing.base', createBase: false, appendEmbed: false,
      renameLegacyKey: true,
    });
  });

  it('reports non-list legacy values as invalid and skips other note types', () => {
    const plan = planPlaylistMigration(input({
      playlists: [
        playlist({ frontmatter: { type: 'music-playlist', tracks: 'not a list' } }),
        playlist({ path: 'Other.md', frontmatter: { type: 'music', tracks: 'not a list' } }),
      ],
    }));

    expect(plan.invalid).toEqual(['Music/노동요.md']);
    expect(plan.playlists).toEqual([]);
    expect(plan.totals.invalid).toBe(1);
  });

  it('reads the configured legacy key rather than the default tracks key', () => {
    const plan = planPlaylistMigration(input({
      mapping: { ...DEFAULT_PROPERTY_MAPPING, legacyPlaylistTrackProperty: 'songs' },
      playlists: [playlist({
        frontmatter: { type: 'music-playlist', songs: ['[[Song]]'], tracks: 'not a list' },
      })],
    }));

    expect(plan.invalid).toEqual([]);
    expect(plan.playlists[0]?.renameLegacyKey).toBe(true);
    expect(plan.totals.membershipAdds).toBe(1);
  });

  it('ignores null frontmatter and malformed refs without losing aligned resolutions', () => {
    const plan = planPlaylistMigration(input({
      playlists: [
        playlist({ path: 'Null.md', frontmatter: null }),
        playlist({
          trackRefs: [null, 7, {}, '', '[[]]', '[[Song]]', '[[Song|Again]]', '[[Missing]]', '[[Missing]]'],
          resolvedTrackPaths: [null, null, null, null, null, 'Music/Song.md', 'Music/Song.md', null, null],
        }),
      ],
    }));

    expect(plan.playlists).toHaveLength(1);
    expect(plan.playlists[0]?.membershipAdds).toEqual(['Music/Song.md']);
    expect(plan.playlists[0]?.missing).toEqual(['[[Missing]]']);
    expect(plan.invalid).toEqual([]);
  });

  it('does not re-add a track already linked to this playlist', () => {
    const plan = planPlaylistMigration(input({
      playlists: [playlist({
        trackRefs: ['[[Song]]', '[[Other]]'],
        resolvedTrackPaths: ['Music/Song.md', 'Music/Other.md'],
      })],
      trackMembership: new Map([
        ['Music/Song.md', ['Music/노동요.md']],
        ['Music/Other.md', ['Music/Another playlist.md']],
      ]),
    }));

    expect(plan.playlists[0]?.membershipAdds).toEqual(['Music/Other.md']);
  });

  it('keeps a root playlist base at vault root', () => {
    const plan = planPlaylistMigration(input({
      playlists: [playlist({ path: 'Mix.md', basename: 'Mix', folder: '/' })],
    }));

    expect(plan.playlists[0]?.basePath).toBe('Mix.base');
  });
});
