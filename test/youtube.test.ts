import { describe, expect, it } from 'vitest';
import { buildYoutubeEmbedUrl, buildYoutubeThumbnailUrl, extractYoutubeVideoId } from '../src/utils/youtube';

describe('extractYoutubeVideoId', () => {
  it('parses watch urls', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/watch?v=Zs3CIgFET_Y')).toBe('Zs3CIgFET_Y');
  });

  it('parses short urls', () => {
    expect(extractYoutubeVideoId('https://youtu.be/DEyzYWLvXqA?si=abc')).toBe('DEyzYWLvXqA');
  });

  it('parses embed urls', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/embed/wOzHXgqNpe8')).toBe('wOzHXgqNpe8');
  });
});

describe('youtube url builders', () => {
  it('builds embed urls with js api enabled', () => {
    expect(buildYoutubeEmbedUrl('DEyzYWLvXqA')).toContain('enablejsapi=1');
  });

  it('builds thumbnail urls', () => {
    expect(buildYoutubeThumbnailUrl('DEyzYWLvXqA')).toBe('https://img.youtube.com/vi/DEyzYWLvXqA/mqdefault.jpg');
  });
});
