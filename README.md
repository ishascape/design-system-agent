# Design System Agent

Turns websites, codebases and Figma files into three linked outputs: tested React/TypeScript components with DTCG tokens, native editable Figma components and variables, and a documentation site. All three are tied together by one versioned registry.

First test source: ashnidave.com. Status: Gate 0 (feasibility).

## How the repo is organised

| Folder | Job |
| --- | --- |
| `docs/adr/` | Architecture decision records |
| `docs/gate-0/` | Feasibility evidence, including the Figma capability test |
| `schemas/` | JSON schemas for the registry, audits and Figma mapping (Gate 1) |
| `sources/ashnidave/` | Config only: repo, pinned commit, live URL. No copied site code |
| `audits/ashnidave/` | Gate 1 audit output with evidence and confidence |
| `registry/` | The source of truth: DTCG tokens, component specs, Figma id map |
| `packages/` | discovery, registry, gen-tokens, gen-figma, ui (added as each gate needs them) |
| `apps/` | Storybook docs site (Gate 2) |
| `tests/` | Golden fixtures for every transformation |

Folders are added with content as each gate needs them, so empty ones are not committed yet.

## Rules

See `CLAUDE.md`. In short: sources stay read-only, every decision has provenance, and nothing is called done until checks have run.
