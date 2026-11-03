import { describe, expect, it } from 'vitest';
import { buildYoutubeThumbnailUrl, extractYoutubeVideoId, parseYoutubeUrl } from '../src/utils/youtube';

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

  it('accepts youtube subdomains', () => {
    expect(extractYoutubeVideoId('https://music.youtube.com/watch?v=Zs3CIgFET_Y')).toBe('Zs3CIgFET_Y');
    expect(extractYoutubeVideoId('https://youtube.com/watch?v=Zs3CIgFET_Y')).toBe('Zs3CIgFET_Y');
  });

  it('rejects look-alike hosts', () => {
    expect(extractYoutubeVideoId('https://evilyoutube.com/watch?v=Zs3CIgFET_Y')).toBeNull();
    expect(extractYoutubeVideoId('https://youtube.com.evil.io/watch?v=Zs3CIgFET_Y')).toBeNull();
    expect(extractYoutubeVideoId('https://notyoutube-nocookie.com/embed/wOzHXgqNpe8')).toBeNull();
  });
});

describe('youtube url builders', () => {
  it('builds thumbnail urls', () => {
    expect(buildYoutubeThumbnailUrl('DEyzYWLvXqA')).toBe('https://i.ytimg.com/vi/DEyzYWLvXqA/hqdefault.jpg');
  });
});

describe('parseYoutubeUrl', () => {
  const ID = 'Zs3CIgFET_Y';
  const video = (extra: object = {}) => ({ kind: 'video', videoId: ID, ...extra });

  it('parses video forms', () => {
    for (const url of [
      `https://www.youtube.com/watch?v=${ID}`,
      `https://m.youtube.com/watch?v=${ID}`,
      `https://music.youtube.com/watch?v=${ID}`,
      `https://youtu.be/${ID}?si=x`,
      `https://www.youtube.com/shorts/${ID}`,
      `https://www.youtube.com/live/${ID}`,
      `https://www.youtube.com/embed/${ID}`,
      `https://www.youtube.com/v/${ID}`,
      `https://www.youtube-nocookie.com/embed/${ID}`,
      `youtube.com/watch?v=${ID}`,
      `  ${ID}  `,
    ]) {
      expect(parseYoutubeUrl(url), url).toEqual(video());
    }
  });

  it('keeps the list id on video urls', () => {
    expect(parseYoutubeUrl(`https://youtu.be/${ID}?list=PLabcdefghij`)).toEqual(video({ listId: 'PLabcdefghij' }));
    expect(parseYoutubeUrl(`https://www.youtube.com/watch?v=${ID}&list=PLabcdefghij&index=3`))
      .toEqual(video({ listId: 'PLabcdefghij' }));
  });

  it('treats mix lists as video only', () => {
    expect(parseYoutubeUrl(`https://www.youtube.com/watch?v=${ID}&list=RD${ID}`)).toEqual(video());
    expect(parseYoutubeUrl(`https://www.youtube.com/watch?list=RD${ID}`)).toBeNull();
  });

  it('parses playlist urls', () => {
    expect(parseYoutubeUrl('https://www.youtube.com/playlist?list=PLabcdefghij'))
      .toEqual({ kind: 'playlist', listId: 'PLabcdefghij' });
    expect(parseYoutubeUrl('https://music.youtube.com/playlist?list=OLAK5uy_x1234'))
      .toEqual({ kind: 'playlist', listId: 'OLAK5uy_x1234' });
    expect(parseYoutubeUrl('https://www.youtube.com/watch?list=PLabcdefghij'))
      .toEqual({ kind: 'playlist', listId: 'PLabcdefghij' });
  });

  it('rejects everything else', () => {
    for (const input of [
      `https://evilyoutube.com/watch?v=${ID}`,
      `evilyoutube.com/watch?v=${ID}`,
      'https://www.youtube.com/watch?v=short',
      'https://www.youtube.com/@channel',
      'https://example.com',
      '',
      'not a url',
    ]) {
      expect(parseYoutubeUrl(input), input).toBeNull();
    }
  });
});
