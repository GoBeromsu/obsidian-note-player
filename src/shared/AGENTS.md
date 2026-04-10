<!-- Parent: ../AGENTS.md -->
<!-- Added: 2026-04-10 -->

# src/shared/ — Repo-Local Plugin Support

## Purpose

Local support modules that stay close to Note Player runtime behavior. These files may originate from boiler-template baselines, but this directory is owned by this repo.

## Key Files

| File | Purpose |
|------|---------|
| `plugin-logger.ts` | Console + notice logging helper for Note Player |
| `plugin-notices.ts` | Notice rendering, mute state, and lifecycle helpers |

## For AI Agents

- Edit these files in-repo when Note Player behavior changes; do not assume an upstream sync will carry the change
- Keep APIs small and plugin-scoped so shared harness tooling can stay separate from runtime behavior
- Preserve Obsidian-only dependencies here; domain code must stay independent

## Dependencies

- `obsidian` — `Notice`, `setIcon`
- Repo-local settings shape from `main.ts`
