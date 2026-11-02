# ADR 0001: Architecture for the design system agent

Status: Proposed (awaiting Ashni's approval) · Date: 2026-11-02

## Context

We need three linked outputs (React/TS components with tokens, native Figma components and variables, a docs site) from sources we must not modify. Ashni is a designer, the team is one person plus Claude, and the first source is a small React + Vite site (ashnidave.com, repo `October-Portfolio`). Ashni's Figma account is on the free Starter plan with a Full seat.

## Decision

1. **Own private repo** (`design-system-agent`), separate from every source project. Sources are read at a pinned commit and never written to.
2. **AI proposes, scripts generate.** Claude produces audits and proposals. Once Ashni approves, deterministic scripts generate every output from the registry. AI output is validated against JSON schemas before any file is written.
3. **Registry = decisions and links only.** DTCG token JSON, one spec file per component (id, variants, states, token links, source refs, confidence), and `figma-map.json`. It does not copy code or docs text. React code is the truth for behaviour.
4. **Reuse boring tools.** Style Dictionary (Apache 2.0) for token builds, Storybook (MIT) for the docs site, Vitest + Testing Library + axe + Playwright for checks. `figma/sds` (MIT) as a reference.
5. **Figma via the official Figma MCP `use_figma` tool** (Plugin API), writing only to a test file or an approved copy, updating nodes by stored ids. Every write is followed by a scripted read-back. Fallback: a small plugin of our own run inside Figma.
6. **Not adopted as core:** Supernova (paid SaaS, lock-in, overlaps Storybook), Layout Studio (AGPL app, AI-context output rather than a tested library), Tokens Studio's own store (would be a second source of truth). GitFig is re-evaluated at Gate 4 for Figma-to-repo token pull.

## Alternatives considered

- **Hosted platform (Supernova):** fastest to a portal, but paid, closed and duplicative.
- **AI generates every output directly:** quick demo, but not repeatable and impossible to test.
- **Custom docs portal from day one:** more control, but Storybook covers previews, controls and prop tables for free. Revisit at Gate 3.

## Consequences

- Zero running cost beyond Figma and Claude usage; nothing is hosted until Ashni chooses to publish.
- Figma remains the least testable output. The Gate 0 test showed one binding silently failing until read back, so read-back checks are mandatory.
- Starter plan limits: MCP read calls are capped (Figma lists 20 per month for View and Collab seats on Starter; no figure is listed for a Full seat), Figma says write tools are exempt from rate limits but does not name `use_figma` in its examples, and write to canvas is free only during beta. Variable modes on the free plan are limited (to verify), which matters for light and dark themes later.
