const YOUTUBE_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;

export type YoutubeTarget =
  | { kind: 'video'; videoId: string; listId?: string }
  | { kind: 'playlist'; listId: string };

const YOUTUBE_LIST_PATTERN = /^[a-zA-Z0-9_-]{10,}$/;
const SCHEMELESS_PATTERN = /^(?:(?:www|m|music)\.)?(?:youtube\.com|youtu\.be)\//i;
const VIDEO_PATH_PREFIXES = ['embed', 'shorts', 'live', 'v'];

export function parseYoutubeUrl(input: string): YoutubeTarget | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  if (YOUTUBE_ID_PATTERN.test(trimmed)) {
    return { kind: 'video', videoId: trimmed };
  }

  let url: URL;
  try {
    url = new URL(SCHEMELESS_PATTERN.test(trimmed) ? `https://${trimmed}` : trimmed);
  } catch {
    return null;
  }

  const hostname = url.hostname.toLowerCase();
  const segments = url.pathname.split('/').filter(Boolean);
  const listId = sanitizeList(url.searchParams.get('list'));

  if (hostname === 'youtu.be') {
    return toTarget(sanitizeCandidate(segments[0] ?? null), listId);
  }

  if (!isYoutubeHost(hostname)) {
    return null;
  }

  const videoId = sanitizeCandidate(url.searchParams.get('v'))
    ?? (VIDEO_PATH_PREFIXES.includes(segments[0] ?? '') ? sanitizeCandidate(segments[1] ?? null) : null);
  if (videoId || !listId || !['playlist', 'watch'].includes(segments[0] ?? '')) {
    return toTarget(videoId, listId);
  }
  return { kind: 'playlist', listId };
}

export function extractYoutubeVideoId(input: string): string | null {
  const target = parseYoutubeUrl(input);
  return target?.kind === 'video' ? target.videoId : null;
}

function toTarget(videoId: string | null, listId: string | null): YoutubeTarget | null {
  if (!videoId) {
    return null;
  }
  return listId ? { kind: 'video', videoId, listId } : { kind: 'video', videoId };
}

// Mix/radio lists (RD…) are generated per video and cannot be enumerated.
function sanitizeList(value: string | null): string | null {
  return value && YOUTUBE_LIST_PATTERN.test(value) && !value.startsWith('RD') ? value : null;
}

export function buildYoutubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function buildYoutubeThumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

function isYoutubeHost(hostname: string): boolean {
  return ['youtube.com', 'youtube-nocookie.com'].some(
    (root) => hostname === root || hostname.endsWith(`.${root}`),
  );
}

function sanitizeCandidate(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return YOUTUBE_ID_PATTERN.test(trimmed) ? trimmed : null;
}
