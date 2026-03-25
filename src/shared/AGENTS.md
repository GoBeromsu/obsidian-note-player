<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-25 | Updated: 2026-03-25 -->

# src/shared/ — Boiler-Template Synced Code

## Purpose

Shared, deterministic code synced from `obsidian-boiler-template`. Every plugin in the ecosystem uses these modules to ensure consistent patterns for logging, notices, and settings migration.

## Key Files

| File | Purpose |
|------|---------|
| `plugin-logger.ts` | Debug logger with lazy formatting; respects settings.debug flag |
| `plugin-notices.ts` | Catalog-driven notice system with variable interpolation; prevents duplicate notices |
| `settings-migration.ts` | Version-based settings schema migrations; automatic normalization on load |
| `styles.base.css` | Base CSS grid, typography, and component styles (optional override per plugin) |

## Subdirectories

None.

## For AI Agents

- **Never edit directly**: These files are synced from obsidian-boiler-template via script
- **Breaking changes**: If a bug is found, fix it in boiler-template first, then propagate
- **Adding new patterns**: If you prove a new pattern, add it to boiler-template and sync
- **Plugin-specific overrides**: Create `styles.css` (not styles.base.css) for plugin-specific styling
- **PluginLogger usage**: Call `logger.debug()`, `logger.info()`, `logger.error()` — no console.log
- **PluginNotices catalog**: Define notice keys in `domain/notices.ts`; use `notices.show(key, vars)`
- **Settings migration**: Add version logic in config.ts normalizeSettings(); boiler-template provides infrastructure

## Dependencies

- `obsidian` — used for I/O and API integration
- Boiler-template sync engine — tracks version and auto-updates
