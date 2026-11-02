# Tasks

## Done in MVP v1 so far

- [x] Gate 0 feasibility, Figma capability test on the free plan
- [x] Repo foundations: workspaces, strict TypeScript, ESLint, Prettier, Vitest
- [x] Extraction engine: fetch at pinned commit, static audit, drift report, component candidates, golden tests
- [x] First audit of ashnidave.com (39 custom properties, 30 hard-coded colours, 593 px uses, 10 reusable component candidates)
- [x] Rendered evidence for the Button at 375, 768 and 1280px
- [x] Button vertical slice: canonical tokens → React Button → Storybook docs → agent catalog → native Figma component set → parity, docs and Figma read-back checks
- [x] CI (typecheck, lint, format, unit tests, generated-file freshness, catalog check, Storybook build and browser checks)

## Waiting on Ashni (product decisions)

- [ ] Approve the Button spec, or ask for changes (`registry/components/button.json`, Storybook, Figma file)
- [x] Disabled state: 45% opacity (decided 2026-11-02)
- [x] Outline weight: 1px (decided 2026-11-02)
- [x] Token names approved (2026-11-02)
- [ ] Confirm `October-Portfolio` is the repo behind the live site
- [x] Next four components: Label, Annotation, Paper sheet, Lightbox (decided 2026-11-02)
- [x] Where the Studio app runs first: on Ashni's computer (decided 2026-11-02)

## Next (engineering)

1. Remaining four components, each as a full vertical slice. Proposed from the audit evidence:
   - **Label / Tag** (`label`, used in 10 files)
   - **Annotation** (handwritten note, 6 files; tests the `font.family.hand` token)
   - **Paper sheet** (surface, 4 files)
   - **Lightbox / Detail sheet** (dialog: focus trap, Escape, scroll lock)
2. Typography tokens: line-height and letter-spacing, plus Figma text styles.
3. Generalise `gen-figma` from Button-specific to spec-driven, so each new component does not need its own script.
4. Docs portal pages: Overview, Foundations (colour, type, space), Accessibility, Usage, Changelog.
5. Focus-ring token to replace the fixed 2px/3px constant.
6. Update the Gate 0 doc with the tool's numbers (30 colours, 593 px uses) instead of the earlier grep counts.

## Design System Studio (brief from Ashni, 2026-11-02)

Local app in `apps/studio`. Milestones:

- [x] **M1: workspace.** Projects dashboard, multi-project storage (SQLite, stable ids, isolated folders), navigation, settings, sources.
- [x] **M2: workflow.** Canvas with the 10 stages, real execution, inspector (summary, output, logs, files), approvals, retries, reruns with changed inputs, cancel, run history, restart recovery.
- [ ] **M3: extraction for real projects.** Run ashnidave.com end to end in the Studio; screenshots and evidence in the inspector; website import for sites that render with JavaScript.
- [ ] **M4: generation.** Done: docs site and agent catalog from approved tokens, validation stage (pass, fail or not run per check). Figma variables through the Studio plugin, checked against a read-back. Open: components from approved specs, in code and Figma.
- [ ] **M5: assistant and versioning.** Project-aware assistant that proposes typed actions and asks before destructive, costly or published changes; change proposals and diffs between versions. Needs a decision on which model API key to use and its cost.

First end-to-end target: ashnidave.com → one reusable tested component, its Figma twin and a documented page.

## Later

- Second source: HeadBox (Figma-first, confidential), which tests the Figma → registry direction.
- Themes (dark mode) once variable-mode limits on the free plan are verified.
- Publishing the package and docs site (needs Ashni's approval).
