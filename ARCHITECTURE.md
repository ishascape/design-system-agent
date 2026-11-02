# Architecture

One pipeline, one source of truth. Every output is generated from the registry by a deterministic script, and every step validates its output before writing it.

```
 source repo (read-only, pinned commit)
        │  source:fetch
        ▼
 ┌──────────────┐  audit   ┌───────────────────────┐   render   ┌──────────────────────────┐
 │ .cache/      │ ───────▶ │ audits/<id>/          │ ◀───────── │ local build of the source│
 │ sources/<id> │          │ inventory.json (zod)  │            │ computed styles + PNGs   │
 └──────────────┘          │ drift + components md │            └──────────────────────────┘
                           └──────────┬────────────┘
                                      │ human-curated token map + component spec
                                      ▼
                     ┌─────────────────────────────────────┐
                     │ registry/  (the source of truth)    │
                     │  tokens/<id>.token-map.json  curated│
                     │  tokens/<id>.tokens.json     DTCG   │
                     │  components/<id>.json        spec   │
                     │  figma-map.json              ids    │
                     └──┬───────────────┬───────────────┬──┘
           tokens build │               │               │ figma script / check
                        ▼               ▼               ▼
        packages/tokens/dist   packages/ui (React)   Figma file (variables +
        tokens.css             Button.tsx + CSS      component set) via the
        tokens.manifest.json   Storybook stories     official Figma MCP
                        │               │               │
                        └───────┬───────┘               │ read-back JSON
                                ▼                       ▼
                 catalog: docs/agents/*, llms.txt   checkReadback()
                 consistency check (--check)        updates figma-map.json
```

## Stages

1. **Fetch** (`packages/discovery/src/cli/fetch-source.ts`). Clones the source at the commit pinned in `sources/<id>/source.json` with git hooks disabled. The source is parsed, never executed, except for a local build with install scripts off, which is used only for rendered evidence.
2. **Audit** (`discovery`). PostCSS reads custom properties, media overrides and hard-coded values. The TypeScript compiler finds class usages in JSX. Output is validated against `AuditInventory` (zod). Every value carries `file:line` and a confidence: observed, inferred or proposed.
3. **Render** (`discovery/src/cli/render.ts`). Serves the built source on 127.0.0.1 and records computed styles and screenshots for each target, state and width.
4. **Promote tokens** (`packages/tokens`). The curated token map names tokens. Values and provenance always come from the audit inventory, so every canonical value traces to a source line. Responsive, fluid and reduced-motion values are kept in `$extensions`.
5. **Build tokens** (Style Dictionary 5). Produces `tokens.css` and `tokens.manifest.json`. The manifest is the single token input for Figma, the docs and agents.
6. **Components** (`packages/ui`). React components use only token CSS variables for colour, spacing, type and lines. Fixed geometry is listed as constants in the spec, with a reason.
7. **Docs** (`apps/storybook`, `packages/catalog`). Storybook for people. A JSON catalog, per-component Markdown and `llms.txt` for agents, with props extracted from the TypeScript types by the compiler.
8. **Figma** (`packages/gen-figma`). Builds a payload from the manifest, the spec and `figma-map.json`, and wraps it in an idempotent Plugin API script. Claude runs the script through the official Figma MCP `use_figma` tool with Ashni's own login. The script returns a structural read-back, which `checkReadback` compares with the registry before any ids are saved.

## Why Figma is a two-step contract

No Figma token is stored in this repo. The script is generated and checked here, and executed through the MCP connection. The read-back check is what makes the Figma output testable: it confirms node types, variant names, every variable binding, visibility of state layers, and that paint fallback colours match their variables.

## Consistency checks that tie the outputs together

- `catalog --check`: every token in a spec exists. Every CSS variable used in the component CSS is declared in the spec. Spec variants match the code's `BUTTON_VARIANTS`. Generated files are not stale.
- Parity test: the generated Button's computed styles match the source's rendered styles at 375, 768 and 1280px for default, hover and focus.
- Figma read-back: the component set matches the spec and binds the same tokens.

## Where the code is

| Concern            | Entry point                                            |
| ------------------ | ------------------------------------------------------ |
| Schemas            | `packages/registry/src/{audit,component}.ts`           |
| Audit              | `packages/discovery/src/audit.ts`                      |
| Token promotion    | `packages/tokens/src/promote.ts`                       |
| Token build        | `packages/tokens/src/build.ts`                         |
| Button             | `packages/ui/src/button/`                              |
| Catalog and checks | `packages/catalog/src/catalog.ts`                      |
| Figma contract     | `packages/gen-figma/src/generate.ts`, `plugin/sync.js` |
