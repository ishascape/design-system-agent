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

## The Studio

`apps/studio` is a local app on top of the same packages. It runs on 127.0.0.1 only and checks the Host and Origin headers, so other sites in your browser cannot call it.

- **Server** (`server/`): Hono on Node. `db.ts` is the store (Node's built-in SQLite, so there are no native installs); every project query filters by project id. `workflow/engine.ts` runs a workflow's steps in order and keeps all state in the database: one active run per project, a step that needs approval pauses the run, a rerun resets that step and everything after it, cancel uses an AbortController, and steps that were running when the server stopped are marked interrupted on start. `workflow/design-system.ts` defines the 10 stages on top of `discovery` and `tokens`. Stages that are not built throw `StepBlocked`, which shows as "Not available yet" rather than a fake success. A stage marked optional (Figma) lets later stages run when it is blocked. `generate/docs-site.ts` writes the docs site (one HTML file, no scripts, every source value escaped, served sandboxed) and the agent catalog from the token manifest; `generate/validate.ts` checks every generated output and reports pass, fail or not run.
- **Sources** (`server/sources.ts`): GitHub over HTTPS only, cloned at a pinned commit with hooks disabled; websites are downloaded with their same-origin stylesheets, with size limits. Imported copies are read-only inputs and are never executed.
- **Files**: each stage saves versioned artifacts (per project and kind) under `STUDIO_HOME/projects/<id>/`. They are served as plain text with a sandboxing CSP, never as HTML.
- **Interface** (`web/`): React and React Flow, built by Vite into `dist-web/` and served by the same server. It refetches when the server sends a change event (SSE); no timers simulate progress.

## Where the code is

| Concern            | Entry point                                            |
| ------------------ | ------------------------------------------------------ |
| Schemas            | `packages/registry/src/{audit,component}.ts`           |
| Studio server      | `apps/studio/server/{app,db,sources}.ts`, `workflow/`  |
| Studio interface   | `apps/studio/web/src/`                                 |
| Audit              | `packages/discovery/src/audit.ts`                      |
| Token promotion    | `packages/tokens/src/promote.ts`                       |
| Token build        | `packages/tokens/src/build.ts`                         |
| Button             | `packages/ui/src/button/`                              |
| Catalog and checks | `packages/catalog/src/catalog.ts`                      |
| Figma contract     | `packages/gen-figma/src/generate.ts`, `plugin/sync.js` |
