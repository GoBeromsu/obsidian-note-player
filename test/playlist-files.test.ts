import { describe, expect, it } from 'vitest';
import { createCompanionNoteContent, playlistFilePaths } from '../src/domain/playlist-files';

describe('companion notes', () => {
  it('embeds its base and writes provided playlist metadata without tracks', () => {
    const content = createCompanionNoteContent({
      noteType: 'playlist', descriptionProperty: 'summary', coverProperty: 'art',
      description: 'Focus', cover: 'cover.jpg', baseFileName: '노동요.base',
    });

    expect(content).toBe('---\ntype: "playlist"\n"summary": "Focus"\n"art": "cover.jpg"\n---\n\n![[노동요.base]]\n');
  });

  it.each(['my "odd" prop', 'back\\slash', 'mood: calm', '#mood', '노동요'])(
    'escapes frontmatter metadata for %s',
    (value) => {
      const content = createCompanionNoteContent({
        noteType: value, descriptionProperty: value, coverProperty: 'cover',
        description: value, cover: value, baseFileName: 'Mix.base',
      });

      expect(content.split('\n')).toEqual([
        '---', `type: ${JSON.stringify(value)}`,
        `${JSON.stringify(value)}: ${JSON.stringify(value)}`,
        `"cover": ${JSON.stringify(value)}`, '---', '', '![[Mix.base]]', '',
      ]);
    },
  );

  it('omits absent values and empty metadata properties', () => {
    const content = createCompanionNoteContent({
      noteType: 'playlist', descriptionProperty: '', coverProperty: 'cover',
      description: 'ignored', baseFileName: 'Mix.base',
    });

    expect(content).toBe('---\ntype: "playlist"\n---\n\n![[Mix.base]]\n');
  });
});

describe('playlist file paths', () => {
  it('reserves a shared sanitized stem against both file types', () => {
    const existing = new Set(['Playlists/Focus mix.md', 'Playlists/Focus mix 2.base']);

    expect(playlistFilePaths('Playlists', ' Focus: mix? ', (path) => existing.has(path))).toEqual({
      notePath: 'Playlists/Focus mix 3.md', basePath: 'Playlists/Focus mix 3.base',
    });
  });

  it.each(['', '/'])('creates vault-relative paths at root %s', (folder) => {
    expect(playlistFilePaths(folder, '노동요', () => false)).toEqual({
      notePath: '노동요.md', basePath: '노동요.base',
    });
  });

  it.each(['  ', '\\/:*?"<>|#^'])('uses a non-empty stem for unusable name %s', (name) => {
    expect(playlistFilePaths('/Playlists/', name, () => false)).toEqual({
      notePath: 'Playlists/New Playlist.md', basePath: 'Playlists/New Playlist.base',
    });
  });
});
