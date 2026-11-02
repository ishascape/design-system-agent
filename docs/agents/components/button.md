# Button

> An action or navigation link with an ink outline or fill that turns marker blue on hover, with registration corner marks on hover and focus.

Status: **pending-approval** · Version 0.2.0 · Source: ashnidave @ `e072889`

## Use it

```tsx
import { Button } from '@dsa/ui';
import '@dsa/ui/styles.css';
<Button href="#work" variant="primary" icon="↓">Explore my work</Button>
<Button onClick={copyEmail}>Copy email</Button>
```

When to use:
- To trigger an action on the page, such as copying an email address.
- To link to a key destination styled as an action, such as the resume or the work section.

When not to use:
- Inside another link or button. Make the outer element the only interactive one.
- For inline links within body text. Use a plain text link.
- More than one primary button in the same view.

## Props

Generated from `packages/ui/src/button/Button.tsx`. All other native `<button>` or `<a>` attributes (`onClick`, `aria-*`, `target`, ...) are passed through.

| Prop | Type | Description |
| --- | --- | --- |
| `variant` | ButtonAsButton: `"outline" \| "primary"`<br>ButtonAsLink: `"outline" \| "primary"` | `outline` is the default action style. `primary` is for the single most important action in a view. Source: `.button` and `.button--primary` on ashnidave.com. |
| `children` | ButtonAsButton: `ReactNode` (required)<br>ButtonAsLink: `ReactNode` (required) | The visible label. Keep it short and start with a verb, e.g. "Explore my work". |
| `icon` | ButtonAsButton: `ReactNode`<br>ButtonAsLink: `ReactNode` | Optional icon after the label, such as an arrow. Decorative: it is hidden from screen readers, so the label must make sense on its own. |
| `href` | ButtonAsButton: `undefined`<br>ButtonAsLink: `string` (required) | Leave unset to render a `<button>`. |
| `disabled` | ButtonAsLink: `never` | Not allowed on links: links cannot be disabled. |

## Variants

| Variant | Description | Confidence |
| --- | --- | --- |
| `outline` | Default. Transparent fill, ink outline and ink label. | observed |
| `primary` | Ink fill with a paper label. For the single most important action in a view. | observed |

## States

| State | Trigger | Looks like | Confidence |
| --- | --- | --- | --- |
| default | At rest. | As the variant describes. | observed |
| hover | Pointer over the button. | Marker fill and outline, paper label, corner marks appear. | observed |
| focus-visible | Keyboard focus. | 2px marker outline offset 3px, corner marks appear. Fill unchanged. | observed |
| disabled | disabled attribute on a button (links cannot be disabled). | 45% opacity, no hover change, not-allowed cursor. Not in the source; decided by Ashni on 2026-11-02. | decided |

## Anatomy

- **container**: The outlined or filled shape; the hit area is at least 44px tall.
- **label**: The visible text, which is also the accessible name.
- **icon** (optional): Optional decorative icon after the label, such as an arrow.
- **corner marks**: Two registration marks at opposite corners, shown on hover and focus.

## Tokens

| Token | CSS variable | Value | Used for |
| --- | --- | --- | --- |
| `color.ink` | `--color-ink` | `#1c1b19` | outline, label (outline variant), fill (primary variant) |
| `color.paper` | `--color-paper` | `#f5f2ea` | label on primary and on hover |
| `color.marker` | `--color-marker` | `#2f5fb3` | hover fill and outline, focus ring |
| `color.graphite` | `--color-graphite` | `#615e58` | corner marks at 45% |
| `font.family.sans` | `--font-family-sans` | `Poppins, system-ui, -apple-system, 'Segoe UI', sans-serif` | label |
| `font.size.body` | `--font-size-body` | `clamp(16px, 1.4vw, 18px)` | label |
| `space.2` | `--space-2` | `8px` | gap between label and icon |
| `space.4` | `--space-4` | `28px` | horizontal padding |
| `size.tap` | `--size-tap` | `44px` | minimum height |
| `radius.default` | `--radius-default` | `16px` | corner radius |
| `line.building` | `--line-building` | `1px` | outline and corner mark weight |
| `motion.duration.micro` | `--motion-duration-micro` | `150ms` | hover transition |
| `motion.easing.pen` | `--motion-easing-pen` | `cubic-bezier(0.2, 0, 0, 1)` | hover transition |

Fixed values (deliberately not tokens):
- line-height: `1.65`. Inherited from body in the source; no line-height token exists yet.
- focus ring: `2px solid, offset 3px`. Global :focus-visible rule in the source; candidate for a focus token later.
- corner mark size: `10px, offset -6px`. Decorative geometry from the source.
- corner mark opacity: `45%`. From the source (rgb(97 94 88 / 0.45)).

## Accessibility

Renders: button (type="button" by default); a (when href is set).

Keyboard:
- Tab and Shift+Tab move focus
- Enter activates buttons and links
- Space activates buttons

- The label is the accessible name; the icon is hidden from assistive technology.
- Minimum height 44px meets the touch target guideline.
- Source issue: Work.tsx:70 draws a button as a <span> inside a card link. The component does not support that; make the card the link instead.
- Colour contrast is not checked in unit tests (jsdom cannot render). It is checked in the Storybook accessibility panel.

## Guidelines

Do:
- Start the label with a verb: "Explore my work", "Copy email".
- Use one primary button per view and outline for the rest.
- Use href for navigation so it is a real link.

Don't:
- Don't nest a button in a link or another button.
- Don't use an icon without a label.
- Don't disable a button without telling people why nearby.

## Responsive

- Horizontal padding follows space.4: 28px below 600px, 32px from 600px.
- Label size follows font.size.body: fluid from 16px to 18px.
- Source note: the hero overrides the primary button to 14px text and 8px padding below 600px (src/components/Hero.css:856). That is a page-level override, not a variant.

## Links

- Code: `packages/ui/src/button/Button.tsx`, styles `packages/ui/src/button/button.css`
- Spec: `registry/components/button.json`
- Figma: node `3:19` in file `gate0-test` (generated); ids in `registry/figma-map.json`
- Storybook: `components-button--docs`
- Source evidence: `src/styles/global.css:148-202`, `src/styles/global.css:56`

## Open questions

None.
