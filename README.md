# Design System Agent

Turns websites, codebases and Figma files into three linked outputs, all generated from one versioned registry:

1. **Code:** tested React/TypeScript components and DTCG design tokens.
2. **Figma:** native, editable components and variables (not screenshots).
3. **Docs:** a documentation site for people, plus a machine-readable catalog for AI agents.

First source: ashnidave.com. Status: **MVP v1, Button vertical slice complete and pending design approval.** See `TASKS.md` for what is next.

## Design System Studio (the app)

A local app for running this workflow on any project: create a project from a website or GitHub repository, watch each stage run on a canvas, review and approve the proposed tokens, and download what it produced.

```sh
npm ci --ignore-scripts
npm run studio
```

Then open **http://localhost:4310** in your browser. For website sources, run `npx playwright install chromium` once as well: the Studio then also renders the site in a sandboxed browser, which captures a screenshot and any styles built by JavaScript. Stop it with Ctrl+C in the terminal. The app only listens on your own computer. Its data (projects, runs, imported copies and generated files) lives in `.studio/` in this folder, which git ignores; set `STUDIO_HOME` to keep it somewhere else.

What works today: projects, repository and website sources (websites are also rendered in a sandboxed browser), the 10-stage workflow with real execution, approvals, retries, reruns with changed inputs, cancel, run history, logs and versioned files. After you approve tokens, a run builds them as CSS, writes a documentation site and a catalog for AI agents, hands the tokens to Figma as variables (see below), and validates everything it generated. Importing a Figma file or a package says "Not available yet". Figma components are not generated yet; variables are.

### Tokens into Figma (the Studio plugin)

The Generate Figma stage pauses so you can put the tokens into a Figma file of your choice. The plugin never goes online and never deletes anything: it creates or updates one variable collection.

1. First time only, in the Figma desktop app: **Plugins → Development → Import plugin from manifest…** and pick `apps/studio/figma-plugin/manifest.json` from this folder.
2. In the Studio, click **Copy tokens for Figma**.
3. In Figma, run **Plugins → Development → Design System Studio**, paste, and click **Apply to this file**.
4. Click **Copy result for the Studio**, paste it into the Studio and click **Check Figma result**. The Studio checks every variable (value, type, scopes and the CSS variable) before the stage passes. Or click **Skip Figma this time**; Validate then reports Figma as not checked.

## Setup

Needs Node 22.13 or newer.

```sh
npm ci --ignore-scripts      # install without running package install scripts
npm run check                # typecheck, lint, format check, unit tests
```

The browser checks need Chromium: `npx playwright install chromium`.

## Everyday commands

| Command                           | What it does                                                                             |
| --------------------------------- | ---------------------------------------------------------------------------------------- |
| `npm run check`                   | Typecheck, lint, Prettier check and all unit tests                                       |
| `npm run studio`                  | Builds and starts the Studio at http://localhost:4310                                    |
| `npm run test:studio-ui`          | Browser smoke test of the Studio (build it first with `npm run build -w @dsa/studio`)    |
| `npm run storybook`               | Docs site at http://localhost:6006                                                       |
| `npm run build-storybook`         | Static docs site in `storybook-static/`                                                  |
| `npm run test:docs`               | Opens every story in Chromium: render, interaction tests, axe (includes colour contrast) |
| `npm run tokens -- ashnidave`     | Promotes audited tokens into the registry and builds CSS and the manifest                |
| `npm run catalog`                 | Regenerates the agent catalog, component Markdown and `llms.txt`                         |
| `npm run catalog -- --check`      | Fails if specs, code, CSS and tokens disagree, or generated files are stale              |
| `npm run figma -- script`         | Writes the Figma sync script to `.cache/figma/sync-button.js`                            |
| `npm run figma -- check <result>` | Checks a Figma read-back against the registry and records Figma ids                      |

Source pipeline (needs read access to the private source repo, so it runs locally, not in CI):

| Command                             | What it does                                                           |
| ----------------------------------- | ---------------------------------------------------------------------- |
| `npm run source:fetch -- ashnidave` | Clones the source at its pinned commit into `.cache/` (hooks disabled) |
| `npm run audit -- ashnidave`        | Static audit: tokens, hard-coded values, component candidates          |
| `npm run render -- ashnidave`       | Computed styles and screenshots from a local build of the source       |
| `npm run test:parity`               | Compares the generated Button with the source's rendered styles        |

## How the repo is organised

| Folder                     | Job                                                                        |
| -------------------------- | -------------------------------------------------------------------------- |
| `sources/<id>/`            | Config only: repo, pinned commit, render targets. No copied site code      |
| `audits/<id>/`             | Audit output with evidence, confidence and screenshots                     |
| `registry/`                | The source of truth: token map, DTCG tokens, component specs, Figma id map |
| `packages/registry`        | Zod schemas for audits and component specs                                 |
| `packages/discovery`       | Source fetch, static audit, rendered evidence                              |
| `packages/tokens`          | Token promotion and build (Style Dictionary); output in `dist/`            |
| `packages/ui`              | React components (`@dsa/ui`)                                               |
| `packages/catalog`         | Agent-readable catalog and consistency checks                              |
| `packages/gen-figma`       | Figma export contract: payload, Plugin API script, read-back check         |
| `apps/storybook`           | The docs site                                                              |
| `docs/agents/`, `llms.txt` | Generated docs for AI agents                                               |
| `tests/`                   | Golden files, fixtures, browser checks and the parity test                 |

## Project docs

`ARCHITECTURE.md` (how it fits together), `DECISIONS.md` (why), `TASKS.md` (what is next), `QUALITY.md` (how it is checked), `KNOWN_ISSUES.md` (what is not right yet). Working rules for Claude are in `CLAUDE.md`.
