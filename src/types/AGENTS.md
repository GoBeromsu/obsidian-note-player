<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-25 | Updated: 2026-03-25 -->

# src/types/ — Type Definitions

## Purpose

Pure type definitions and structural contracts. No Obsidian imports. Defines interfaces that `domain/` and `utils/` use, and port contracts for dependency injection.

## Key Files

| File | Purpose |
|------|---------|
| `audio.ts` | AudioFormat type ('mp3', 'wav', 'aac', 'm4a') |
| `music.ts` | MusicTrack, PlaylistNote, MusicLibrarySnapshot — core domain types |
| `notes.ts` | MarkdownNoteSnapshot — file path, basename, frontmatter |
| `playback.ts` | PlaybackState type ('idle', 'playing', 'paused') |
| `settings.ts` | NotePlayerSettings, YoutubePlaylistPropertyMapping — configuration schema |
| `view.ts` | PlaylistViewHost, PlaylistViewState, PlaylistTrack, AudioCachePort — interfaces for composition root |

## Subdirectories

None.

## For AI Agents

- **No Obsidian imports**: Pure TypeScript interfaces only
- **Shim interfaces**: Use these instead of importing obsidian types into domain/utils
  - Example: `VaultAdapter`, `AudioCachePort` are ports that main.ts wires to Obsidian implementations
- **Structural typing**: Interfaces define contracts; implementations in other layers must satisfy them
- **No logic**: Types never contain functions or constructors (except enum-style const objects)
- **Readonly where safe**: Mark arrays and objects as readonly to prevent accidental mutations

## Dependencies

None — types import nothing from project or external packages.
