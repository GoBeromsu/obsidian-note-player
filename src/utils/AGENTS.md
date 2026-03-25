<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-25 | Updated: 2026-03-25 -->

# src/utils/ — Pure Utility Functions

## Purpose

Deterministic, zero-state utility functions with no external dependencies. Functions are testable without mocks or setup. Pure algorithms: string manipulation, URL parsing, deduplication, frontmatter extraction.

## Key Files

| File | Purpose |
|------|---------|
| `dedupe.ts` | Remove duplicate strings from array while preserving order |
| `frontmatter.ts` | Parse and extract YAML frontmatter from note content |
| `wikilink.ts` | Canonicalize Obsidian wikilink paths to vault-relative paths |
| `youtube.ts` | Extract YouTube video ID from URL or validate 11-char ID format |

## Subdirectories

None.

## For AI Agents

- **No state**: Functions must be pure — same input always produces same output
- **No side effects**: No I/O, no API calls, no DOM mutations
- **No dependencies**: Never import from domain, ui, main, or obsidian
- **Error handling**: Throw Error objects or return null; let caller decide recovery
- **Testing**: Unit tests in `test/` use simple inputs and expected outputs — no mocks
- **Documentation**: Each function should have a brief JSDoc comment explaining input/output
- **Minimal exports**: Only export functions that are used by multiple layers

## Dependencies

None — utils imports nothing from project or external packages. Only Node.js stdlib if needed.
