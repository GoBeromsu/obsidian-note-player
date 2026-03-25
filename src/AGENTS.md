<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-25 | Updated: 2026-03-25 -->

# src/ — Source Code Root

## Purpose

Composition root and layered architecture. All source code follows a strict one-way dependency graph: `utils/` and `types/` have no external dependencies, `domain/` has no Obsidian imports, `ui/` wires everything together with Obsidian APIs.

## Key Files

| File | Purpose |
|------|---------|
| `main.ts` | Composition root — wires all layers, implements PlaylistViewHost interface, manages lifecycle |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `domain/` | Business logic — NO obsidian imports, testable in isolation |
| `ui/` | Obsidian-dependent — views, settings, commands, adapters |
| `types/` | Pure type definitions — NO obsidian imports, structural contracts |
| `utils/` | Pure utility functions — zero state, no external dependencies |
| `shared/` | Boiler-template synced — PluginLogger, PluginNotices, settings migration |

## Dependency Flow

```
utils/ ──┐
types/ ──┼── domain/ ── ui/ ── main.ts
shared/ ─┘               │
                          └── shared/
```

## For AI Agents

- **Imports**: `main.ts` imports from ALL layers (composition root pattern)
- **No circular dependencies**: Enforce via ESLint `no-restricted-imports`
- **Layer boundaries**: Read AGENTS.md files in subdirectories for file-level ownership
- **Testing context**: Remote Obsidian testing only (see Ataraxia vault setup in AGENTS.md files)
- **New features**: Implement in `domain/` first (pure logic), then UI in `ui/`, then wire in `main.ts`

## Dependencies

- `obsidian` — imported in `ui/`, `main.ts`, `shared/` only
- `yt-dlp` — spawned via child_process in `domain/audio-cache.ts`
- `node:sqlite` — used in domain storage layer
- Boiler-template shared modules — auto-synced from obsidian-boiler-template
