<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-25 | Updated: 2026-03-25 -->

# src/domain/ — Business Logic Layer

## Purpose

Pure domain logic with zero Obsidian imports. All functions are deterministic and testable with simple stubs. Handles music library indexing, playlist management, audio caching, state tracking, and configuration.

## Key Files

| File | Purpose |
|------|---------|
| `audio-cache.ts` | Audio extraction and caching via yt-dlp; manages download queue and file system |
| `base-files.ts` | Generates companion Music.base and Playlists.base files; snapshot-based |
| `config.ts` | Settings schema, defaults, and normalization logic |
| `library-index.ts` | Builds MusicLibrarySnapshot from vault note snapshots; extracts metadata |
| `notices.ts` | Catalog of user-facing notice messages |
| `playback-state.ts` | Track playback position and queue navigation (no Obsidian API) |
| `playlist-manager.ts` | Query and validate playlists; resolve selected playlist path |
| `playlist-storage.ts` | Read/write playlist frontmatter; update note content |

## Subdirectories

None.

## For AI Agents

- **No obsidian imports**: If you need Obsidian types, define shim interfaces in `types/` instead
- **Deterministic code**: All functions must return same output for same input; no side effects
- **Error handling**: Throw Error objects with descriptive messages; catching happens in `main.ts`
- **Testing**: Unit tests use simple stubs (mock files, mock settings) — see `test/` directory
- **Remote testing**: After implementation, verify in Ataraxia vault (SSH deploy + reload via Obsidian CLI)
- **YT-DLP spawning**: `audio-cache.ts` spawns child processes; timeouts and error handling are critical
- **Dependency direction**: Import from `types/` and `utils/` only — never `ui/` or `main.ts`

## Dependencies

- `types/` — type definitions and interfaces (music, settings, audio, playback, view, notes)
- `utils/` — dedupe, wikilink, frontmatter, youtube ID extraction
- Node.js stdlib — fs, path, child_process, sqlite
