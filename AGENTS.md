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
| `src/` | Source layers intermediate node (see `src/AGENTS.md`) |
| `src/domain/` | Business logic — NO obsidian imports (see `src/domain/AGENTS.md`) |
| `src/ui/` | Obsidian-dependent views, modals, status bar, settings (see `src/ui/AGENTS.md`) |
| `src/ui/views/` | NotePlayerView, PlayerSurface, PlaylistNameModal (see `src/ui/views/AGENTS.md`) |
| `src/types/` | Pure type definitions (see `src/types/AGENTS.md`) |
| `src/utils/` | Pure utility functions (see `src/utils/AGENTS.md`) |
| `src/shared/` | Repo-local plugin support modules — edit here when Note Player behavior changes (see `src/shared/AGENTS.md`) |

## For AI Agents

### Working In This Directory
- 4-layer architecture: `domain/` must not import `obsidian`
- `audio-cache.ts` wraps yt-dlp/ffmpeg — keep all subprocess calls inside it
- Testing is **remote-only** (Ataraxia vault) — do not test on local vault
- `src/shared/` is repo-local support code for this plugin — keep behavior scoped to Note Player
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
- `src/shared/` — repo-local logger and notice support used by `main.ts` and `ui/`
- `obsidian-boiler-template` — shared harness reference for lint/release tooling, not runtime source of truth for `src/shared/`

### External
- `obsidian` — Obsidian Plugin API
- `yt-dlp` — external CLI binary for audio download
- `ffmpeg` — external CLI binary for format conversion
