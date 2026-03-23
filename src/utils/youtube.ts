const YOUTUBE_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;

export function extractYoutubeVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  if (YOUTUBE_ID_PATTERN.test(trimmed)) {
    return trimmed;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  const hostname = url.hostname.toLowerCase();
  const pathname = url.pathname;

  if (hostname === 'youtu.be') {
    return sanitizeCandidate(pathname.slice(1));
  }

  if (
    hostname.endsWith('youtube.com') ||
    hostname.endsWith('youtube-nocookie.com')
  ) {
    const vParam = sanitizeCandidate(url.searchParams.get('v'));
    if (vParam) {
      return vParam;
    }

    const segments = pathname.split('/').filter(Boolean);
    if (segments[0] === 'embed' || segments[0] === 'shorts' || segments[0] === 'live') {
      return sanitizeCandidate(segments[1] ?? null);
    }
  }

  return null;
}

export function buildYoutubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function buildYoutubeEmbedUrl(videoId: string, autoplay = false): string {
  const url = new URL(`https://www.youtube.com/embed/${videoId}`);
  url.searchParams.set('enablejsapi', '1');
  url.searchParams.set('rel', '0');
  url.searchParams.set('playsinline', '1');

  if (autoplay) {
    url.searchParams.set('autoplay', '1');
  }

  return url.toString();
}

export function buildYoutubeThumbnailUrl(videoId: string, quality = 'mqdefault'): string {
  return `https://img.youtube.com/vi/${videoId}/${quality}.jpg`;
}

function sanitizeCandidate(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return YOUTUBE_ID_PATTERN.test(trimmed) ? trimmed : null;
}
