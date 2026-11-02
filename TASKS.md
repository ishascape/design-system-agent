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
- [ ] Disabled state: approve the proposed 45% opacity, or leave disabled unstyled like the source
- [ ] Outline weight: keep the 1.5px token, or use 1px, which is what browsers draw on standard screens
- [ ] Approve the 35 token names in `registry/tokens/ashnidave.token-map.json`
- [ ] Confirm `October-Portfolio` is the repo behind the live site
- [ ] Choose the next four components (proposal below)

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

## Later

- Second source: HeadBox (Figma-first, confidential), which tests the Figma → registry direction.
- Themes (dark mode) once variable-mode limits on the free plan are verified.
- Publishing the package and docs site (needs Ashni's approval).
