<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-25 | Updated: 2026-03-25 -->

# src/ui/ — Obsidian-Dependent Layer

## Purpose

UI and Obsidian API integration. Views, settings tabs, status bars, and modals. Transforms domain logic into user-facing features via Obsidian ItemView, SettingTab, and Modal APIs.

## Key Files

| File | Purpose |
|------|---------|
| `settings.ts` | NotePlayerSettingsTab — PluginSettingTab subclass with property suggestion, format picker, folder selection |
| `download-status-bar.ts` | Status bar showing download progress; cancellation trigger |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `views/` | Individual ItemView components — NotePlayerView, PlayerSurface, PlaylistNameModal |

## For AI Agents

- **Obsidian imports**: Freely import from obsidian here (ItemView, SettingTab, Modal, etc.)
- **Dependencies**: Import from `domain/`, `types/`, `utils/`, `shared/` — never `main.ts`
- **State updates**: Listen to PlaylistViewHost.subscribe() for library changes; re-render on notify
- **Settings tab**: Use Setting API with onChange callbacks; call saveSettings() on host
- **Remote testing**: Build and deploy to Ataraxia vault via SSH; verify UI rendering in Obsidian
- **Modals**: PlaylistNameModal extends Modal; use showAndAwaitInput for user prompts
- **Error display**: Show notices via plugin.notices or status bar

## Dependencies

- `obsidian` — ItemView, SettingTab, Modal, Setting, Notice, Menu, AbstractInputSuggest
- `domain/` — business logic and state management
- `types/` — PlaylistViewHost, PlaylistViewState, NotePlayerSettings
- `utils/` — helper functions
- `shared/` — repo-local PluginNotices and PluginLogger support utilities
