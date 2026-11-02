# Gate 0: Figma capability test

Date: 2026-11-02 · File: [Ai-Design-system-agent](https://www.figma.com/design/wCnc6RXvuK5ZuwanC1epne/Ai-Design-system-agent) (Ashni's scratch file) · Account: Starter plan, Full seat

**Result: pass.** The official Figma MCP can create native variables and a real component set with variant properties, auto layout, variable bindings and a text property on Ashni's free plan.

## What was created

- Variable collection `ashnidave (Gate 0 test)`, 1 mode, 8 variables taken from `October-Portfolio/src/styles/tokens.css`: `color/paper`, `color/ink`, `color/marker`, `radius/default`, `space/2`, `space/4`, `line/building`, `size/tap`. Each has explicit scopes and WEB code syntax (for example `var(--ink)`).
- Component set `Button` (`3:19`): `Variant` = Outline | Primary × `State` = Default | Hover, plus a `Label` text property.
- Every variant: horizontal auto layout, padding, gap, min height, corner radius, stroke colour, stroke weight, fill and text colour bound to variables.

## Checks run

| Check | Result |
| --- | --- |
| `whoami` returns Ashni's account and plan | Pass |
| Create collection and 8 variables with scopes and code syntax | Pass |
| Create 4 variants and combine into a component set | Pass |
| Read back: variant properties are real (`VARIANT` type, 2 × 2 options) | Pass |
| Read back: fills, strokes, text colour, padding, gap, radius, min height bound | Pass |
| Read back: stroke weight bound | **Fail on first try**, fixed by binding each side (`strokeTopWeight` etc.), then pass |
| Instance created, label overridden to "View resume ↗", then removed | Pass (width hugs: 191px) |
| Visual screenshot | Pass, see Ashni's file |

## Gaps found (to handle in Gate 2)

- Hover corner marks (`.button::before/::after`) and the focus state are not modelled yet.
- Font size fixed at 16px; the site uses `clamp(16px, 1.4vw, 18px)`, which Figma cannot express.
- `space/4` uses the 600px+ value (32px); the mobile value is 28px. Needs a decision on how responsive tokens map to Figma.
- The "↗" glyph is not in Poppins, so Figma falls back to an emoji. The site has the same fallback risk.
