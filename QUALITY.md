# Quality

What is checked, where, and what is not. "CI" means it runs on every push and pull request. "Local" means it needs the private source repo or a Figma connection and is run by Claude, with results recorded in the PR.

## Checks

| Check                   | Command                           | Where         | What it proves                                                                                                                     |
| ----------------------- | --------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Types                   | `npm run typecheck`               | CI            | Strict TypeScript across all packages, tests and stories                                                                           |
| Lint                    | `npm run lint`                    | CI            | ESLint recommended + typescript-eslint strict                                                                                      |
| Format                  | `npm run format:check`            | CI            | Prettier                                                                                                                           |
| Discovery golden tests  | `npm test`                        | CI            | Token, drift and component extraction on a fixture site match committed golden files                                               |
| Token tests             | `npm test`                        | CI            | Promotion keeps values and provenance from the audit; CSS output covers responsive, fluid, reduced motion                          |
| Button unit tests       | `npm test`                        | CI            | Rendering, button vs link, default `type`, disabled, keyboard, icon hidden, axe (no contrast), no hard-coded colours               |
| Catalog tests           | `npm test`                        | CI            | Prop extraction and consistency rules                                                                                              |
| Figma contract tests    | `npm test`                        | CI            | Payload, script compiles, read-back check accepts the verified result and rejects the real failures we hit                         |
| Generated files fresh   | tokens + catalog, then `git diff` | CI            | Committed outputs match the registry                                                                                               |
| Catalog consistency     | `npm run catalog -- --check`      | CI            | Spec, code variants, CSS variables and tokens agree                                                                                |
| Storybook browser check | `npm run test:docs`               | CI            | Every story and docs page renders in Chromium, play functions finish, no serious or critical axe issues, including colour contrast |
| Style parity            | `npm run test:parity`             | Local         | 324 computed-style comparisons against the source's rendered Button, 12 documented exceptions                                      |
| Figma read-back         | `npm run figma -- check <result>` | Local         | Component set type, variant names, every binding, state layer visibility, paint fallbacks                                          |
| Figma visual            | MCP screenshot                    | Local, manual | The component set looks right; kept in `audits/ashnidave/figma/button-set.png`                                                     |

## Latest results (2026-11-02)

- Unit tests: **47 passed**, 0 failed (5 files).
- Typecheck, lint, format: passed.
- Catalog check: passed for 1 component.
- Generated files: no diff after regeneration.
- Storybook build: passed. Browser check: **8 stories and docs pages passed**.
- Parity: **passed**, 324 comparisons, 12 documented exceptions (hero's page-level override at 375px).
- Figma: read-back check **passed** for 8 variants and 31 variables; screenshot reviewed.
- CI steps: all passed in a clean copy with `npm ci --ignore-scripts`. Not yet run on GitHub Actions; the first run is on the PR.

## Rules

- Never describe an unexecuted check as passed. If a check could not run, say so and why.
- A check that is changed to pass must be shown failing first on the real problem (done for the Storybook play-function check and the Figma read-back check).
- No test is skipped or disabled to get green.

## Known gaps

- jsdom cannot measure colour contrast; contrast is covered by the browser check only.
- Play functions only run in the browser check, not in Vitest.
- Figma visual review is a human look at a screenshot. There is no pixel comparison yet.
- Parity covers default, hover and focus. Disabled has no source to compare against.
