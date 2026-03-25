<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-25 | Updated: 2026-03-25 -->

# youtube-note-playlist (Note Player)

## Purpose
Note Player (`note-player`) — Obsidian plugin that plays note-backed playlists from YouTube links, cached audio files, and local files. Notes with YouTube URLs become playable playlist entries. Supports `yt-dlp` for audio caching and `ffmpeg` for format conversion (desktop-only).

## Key Files

| File | Description |
|------|-------------|
| `src/main.ts` | Composition root — NotePlayerPlugin, onload/onunload, commands, views |
| `src/domain/config.ts` | DEFAULT_SETTINGS, plugin constants |
| `src/domain/playlist-manager.ts` | Core playlist logic: add, remove, shuffle, navigate tracks |
| `src/domain/playlist-storage.ts` | Persist/load playlist state to vault storage |
| `src/domain/playback-state.ts` | Current track position, play/pause state |
| `src/domain/library-index.ts` | Index of all note-backed audio entries in the vault |
| `src/domain/audio-cache.ts` | yt-dlp download + cache management |
| `src/domain/base-files.ts` | Base path helpers for cache directories |
| `src/domain/notices.ts` | Notice catalog entries |
| `src/ui/views/NotePlayerView.ts` | Main player UI (ItemView) — controls, track info, progress |
| `src/ui/views/PlayerSurface.ts` | Rendered player surface component |
| `src/ui/views/PlaylistNameModal.ts` | Modal for naming new playlists |
| `src/ui/download-status-bar.ts` | Status bar item showing yt-dlp download progress |
| `src/ui/settings.ts` | Settings tab — yt-dlp path, cache directory, quality |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `src/domain/` | Business logic — NO obsidian imports |
| `src/ui/` | Obsidian-dependent views, modals, status bar, settings |
| `src/ui/views/` | NotePlayerView, PlayerSurface, PlaylistNameModal |
| `src/types/` | Pure type definitions |
| `src/utils/` | Pure utility functions |
| `src/shared/` | Boiler-template synced files — DO NOT EDIT |

## For AI Agents

### Working In This Directory
- 4-layer architecture: `domain/` must not import `obsidian`
- `audio-cache.ts` wraps yt-dlp/ffmpeg — keep all subprocess calls inside it
- Testing is **remote-only** (Ataraxia vault) — do not test on local vault
- `src/shared/` synced from `obsidian-boiler-template` — never edit directly
- `isDesktopOnly: true` — Node.js child_process and fs APIs are safe

### Testing Requirements
```bash
pnpm run ci       # build + lint + test
pnpm run lint     # ESLint — 0 errors required
# Runtime testing: deploy to remote Ataraxia vault only
```

### Common Patterns
- Playlist state persisted via `playlist-storage.ts` — use it, don't write raw JSON directly
- Download progress uses status bar item from `download-status-bar.ts` — extend there

## Dependencies

### Internal
- `obsidian-boiler-template` — source of truth for `src/shared/`

### External
- `obsidian` — Obsidian Plugin API
- `yt-dlp` — external CLI binary for audio download
- `ffmpeg` — external CLI binary for format conversion
