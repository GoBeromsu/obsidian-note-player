<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-25 | Updated: 2026-03-25 -->

# src/ui/views/ — View Components

## Purpose

Individual ItemView and Modal implementations. Each file contains a single component responsible for a distinct UI surface: main player view, audio player surface, and playlist name modal.

## Key Files

| File | Purpose |
|------|---------|
| `NotePlayerView.ts` | Main ItemView — registers view type, manages sidebar, library list, track selection, queue UI |
| `PlayerSurface.ts` | Audio player HTML element — audio element, play/pause/next/prev buttons, progress bar, playlist surface |
| `PlaylistNameModal.ts` | Modal for creating new playlists — input field with validation |

## Subdirectories

None.

## For AI Agents

- **ItemView subclass**: NotePlayerView extends ItemView; register in main.ts via registerView()
- **State updates**: Listen to PlaylistViewHost.subscribe(); call notifyChange() to trigger re-render
- **DOM updates**: Use setContent() or direct DOM manipulation; clean up in onClose()
- **Audio element**: PlayerSurface creates and manages `<audio>` tag; do NOT use HTML5 video player
- **Event listeners**: Register in constructor; unregister in destroy() to prevent leaks
- **Modals**: PlaylistNameModal extends Modal; showAndAwaitInput() returns Promise<string | null>
- **Remote testing**: After implementing view changes, test in Ataraxia vault:
  - Deploy via: `pnpm build && scp manifest.json main.js ataraxia-mac:~/...`
  - Reload plugin in Obsidian CLI: `obsidian-cli reload`
  - Take screenshots and verify DOM structure
- **Styling**: Use CSS classes from `styles.css`; follow flat button / Omnisearch-style design

## Dependencies

- `obsidian` — ItemView, Modal, WorkspaceLeaf, Menu, Notice, setIcon
- `domain/audio-cache.ts` — AudioCacheService
- `types/view.ts` — PlaylistViewHost, PlaylistViewState, PlaylistTrack, PlaylistSummary
- `shared/plugin-logger.ts` — PluginLogger
