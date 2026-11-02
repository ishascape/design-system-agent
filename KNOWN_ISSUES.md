# Known issues

Open issues first, then issues found and fixed during MVP v1 (kept so the same mistakes are recognised).

## Open

| Area     | Issue                                                                                                                | Impact                                                    | Next step                                                   |
| -------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------- |
| Design   | Disabled Button state is proposed, not taken from the source.                                                        | Could ship a style Ashni does not want.                   | Ashni's decision.                                           |
| Design   | The 1.5px outline token renders as 1px in Chromium on standard (1x) screens. Figma shows 1.5px.                      | Figma looks slightly heavier than the live site.          | Ashni's decision: keep 1.5px or change to 1px.              |
| Figma    | One variable mode holding mobile-base values. Responsive and fluid values are only described, not modelled.          | Desktop sizes are not switchable in Figma.                | Revisit with themes; verify free-plan mode limits first.    |
| Figma    | No icon slot in the Figma Button yet (code supports an icon).                                                        | Designers cannot add the arrow icon in Figma.             | Add an instance-swap icon property with the first icon set. |
| Figma    | Line-height (165%) and the focus ring (2px, offset 3px) are fixed values, not variables.                             | Cannot be themed in Figma.                                | Add line-height and focus tokens.                           |
| Figma    | Free Starter plan: write access is free only during the MCP beta, and read calls are capped.                         | The Figma sync could start costing or be rate limited.    | Watch Figma's pricing; batch reads.                         |
| Figma    | `gen-figma` is Button-specific.                                                                                      | Each new component would need its own script.             | Generalise before the next four components.                 |
| Evidence | Hover screenshots include the source site's custom cursor.                                                           | Cosmetic, in evidence images only.                        | Hide the cursor element when rendering.                     |
| Source   | `Work.tsx:70` uses a button `<span>` inside a link. The component deliberately does not support this.                | The source pattern has to change when the site adopts it. | Make the card itself the link.                              |
| Source   | The repo behind the live site (`October-Portfolio`) is assumed, not confirmed.                                       | The audit could describe the wrong code.                  | Ashni to confirm from Vercel.                               |
| CI       | Parity and source audit are local-only because the source repo is private.                                           | A parity regression would not fail CI.                    | Optional read-only deploy key, if Ashni wants it.           |
| Docs     | Gate 0 doc still quotes early grep counts (783 px, 29 hex) rather than the tool's numbers (593 px uses, 30 colours). | Inconsistent numbers.                                     | Update the doc.                                             |

## Found and fixed

| Found by                | Issue                                                                                           | Fix                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Gate 0 read-back        | Binding `strokeWeight` to a variable silently did nothing.                                      | Bind each side's stroke weight.                                                          |
| MVP v1 Figma read-back  | Primary variants had no ink fill: the script compared `'primary'` with the spec's `'Primary'`.  | Case-insensitive compare. The failing result is kept as a test fixture.                  |
| MVP v1 Figma screenshot | Hover and focus rendered black: bound paints kept a black fallback colour that Figma displayed. | Fallback colour = token value. Read-back now reports stale paints, and a test covers it. |
| Storybook check         | Play-function status in Storybook 10 is `finished`, so the check timed out.                     | Accept `finished`; proved the check fails on a broken play function.                     |
| Token promotion         | Hand-typed token line numbers were wrong.                                                       | Values and provenance come from the audit inventory only.                                |
| Catalog                 | Prop extraction took over 60 seconds.                                                           | Restricted compiler libs and types; about 0.6 seconds.                                   |
