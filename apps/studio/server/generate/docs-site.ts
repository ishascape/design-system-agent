/**
 * Generates the project's documentation: a self-contained docs site (one HTML file, no scripts)
 * and a plain-text catalog for AI agents. Both are built only from the token manifest and the
 * component candidates, so they can never disagree with the CSS.
 *
 * Every value comes from source files, which are untrusted, so all text is escaped and the
 * embedded stylesheet cannot close its <style> element.
 */
import type { ManifestToken } from '@dsa/tokens';

export interface DocComponent {
  id: string;
  uses: number;
  modifiers: string[];
  states: string[];
  elements: string[];
  onPage?: boolean;
}

export interface DocsInput {
  projectName: string;
  sourceUrl: string;
  runNumber: number;
  generatedAt: string;
  tokens: ManifestToken[];
  tokensCss: string;
  components: DocComponent[];
}

const esc = (s: unknown) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
/** CSS text placed inside <style>: a "<" can never start a closing tag. */
const cssSafe = (css: string) => css.replace(/</g, '\\3c ');
const isSafeVar = (v: string) => /^--[a-z0-9-]+$/.test(v);

export interface TokenSection {
  key: string;
  title: string;
  intro: string;
  tokens: ManifestToken[];
}

/** Groups tokens for the docs: colours, typography, spacing and sizes, radii, motion, other. */
export function sectionsOf(tokens: ManifestToken[]): TokenSection[] {
  const pick = (test: (t: ManifestToken) => boolean) => tokens.filter(test);
  const top = (t: ManifestToken) => t.name.split('.')[0]!;
  const used = new Set<ManifestToken>();
  const take = (key: string, title: string, intro: string, test: (t: ManifestToken) => boolean): TokenSection => {
    const list = pick((t) => !used.has(t) && test(t));
    list.forEach((t) => used.add(t));
    return { key, title, intro, tokens: list };
  };
  const sections = [
    take('color', 'Colour', 'Use these for text, backgrounds and borders.', (t) => t.type === 'color'),
    take(
      'type',
      'Typography',
      'Font families and type sizes.',
      (t) => t.type === 'fontFamily' || ['font', 'text', 'type', 'line-height'].includes(top(t)),
    ),
    take('radius', 'Corner radius', 'Rounding for corners.', (t) => top(t) === 'radius'),
    take(
      'space',
      'Spacing and sizes',
      'Gaps, padding, margins and fixed sizes.',
      (t) => t.type === 'dimension' || t.type === 'number',
    ),
    take(
      'motion',
      'Motion',
      'Durations and easing curves for transitions.',
      (t) => t.type === 'duration' || t.type === 'cubicBezier',
    ),
    take('other', 'Other', 'Tokens that do not fit the groups above.', () => true),
  ];
  return sections.filter((s) => s.tokens.length > 0);
}

const responsiveText = (t: ManifestToken) =>
  (t.responsive ?? []).map((r) => `${r.value} from ${r.minWidth}px`).join(', ');

function preview(t: ManifestToken): string {
  const v = isSafeVar(t.cssVar) ? `var(${t.cssVar})` : '';
  if (!v) return '';
  switch (t.type) {
    case 'color': {
      // Channel tokens (216 210 196) are not a colour on their own, so the swatch uses the hex value.
      const hex = typeof t.value === 'string' && /^#[0-9a-f]{3,8}$/i.test(t.value) ? t.value : v;
      return `<span class="swatch" style="background:${hex}"></span>`;
    }
    case 'fontFamily':
      return `<span class="sample" style="font-family:${v}">Aa Bb Cc 123</span>`;
    case 'dimension':
      if (t.name.startsWith('radius.')) return `<span class="radius" style="border-radius:${v}"></span>`;
      if (/^(font|text|type)\./.test(t.name)) return `<span class="sample" style="font-size:${v}">Aa</span>`;
      return `<span class="bar"><span style="width:min(${v}, 100%)"></span></span>`;
    default:
      return '';
  }
}

function tokenRow(t: ManifestToken): string {
  const p = t.provenance;
  const decided = p.decision
    ? `<div class="decision">Design decision by ${esc(p.decision.decidedBy)} on ${esc(p.decision.date)}: ${esc(
        p.decision.reason,
      )} The source had <code>${esc(p.sourceValue ?? '')}</code>.</div>`
    : '';
  const resp = responsiveText(t);
  return `<tr id="${esc(t.name)}">
  <td class="pv">${preview(t)}</td>
  <td><div class="name">${esc(t.name)}</div><code>${esc(t.cssVar)}</code>${
    t.description ? `<div class="desc">${esc(t.description)}</div>` : ''
  }${decided}</td>
  <td><code>${esc(t.css)}</code>${
    t.type === 'color' && typeof t.value === 'string' && t.value !== t.css
      ? `<div class="muted">RGB channels of ${esc(t.value)}. Use as <code>rgb(var(${esc(t.cssVar)}) / 0.5)</code>.</div>`
      : ''
  }${resp ? `<div class="muted">${esc(resp)}</div>` : ''}${
    t.reducedMotion !== undefined ? `<div class="muted">Reduced motion: ${esc(t.reducedMotion)}</div>` : ''
  }</td>
  <td class="muted">From <code>${esc(p.sourceVar)}</code> at ${esc(p.source)}<br />${esc(p.confidence)}</td>
</tr>`;
}

export function renderDocsSite(d: DocsInput): string {
  const sections = sectionsOf(d.tokens);
  const nav = [
    ...sections.map((s) => `<a href="#s-${s.key}">${esc(s.title)} <span>${s.tokens.length}</span></a>`),
    d.components.length ? `<a href="#s-components">Components <span>${d.components.length}</span></a>` : '',
  ].join('');
  const body = sections
    .map(
      (s) => `<section id="s-${s.key}">
<h2>${esc(s.title)}</h2>
<p class="muted">${esc(s.intro)}</p>
<table>
<thead><tr><th></th><th>Token</th><th>Value</th><th>Source</th></tr></thead>
<tbody>
${s.tokens.map(tokenRow).join('\n')}
</tbody>
</table>
</section>`,
    )
    .join('\n');
  const components = d.components.length
    ? `<section id="s-components">
<h2>Components</h2>
<p class="muted">Found in the source and not generated yet. Each becomes a tested component, a Figma component and a page here once its spec is approved.</p>
<ul class="components">
${d.components
  .map(
    (c) =>
      `<li><div class="name">${esc(c.id)}</div><div class="muted">${
        c.onPage ? `${c.uses} times on the page` : `${c.uses} uses`
      }${c.elements.length ? ` · on ${esc(c.elements.map((e) => `<${e}>`).join(' '))}` : ''}</div>${
        c.modifiers.length ? `<div>Variants: ${esc(c.modifiers.join(', '))}</div>` : ''
      }${c.states.length ? `<div>States: ${esc(c.states.join(', '))}</div>` : ''}</li>`,
  )
  .join('\n')}
</ul>
</section>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(d.projectName)} design system</title>
<style>
/* The project's own tokens, exactly as generated. */
${cssSafe(d.tokensCss)}
</style>
<style>
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; font: 14px/1.5 system-ui, -apple-system, 'Segoe UI', sans-serif; color: #1d1d1f; background: #fbfaf8; }
header { padding: 32px 40px 16px; border-bottom: 1px solid #e6e3dd; background: #fff; }
header h1 { margin: 0 0 4px; font-size: 24px; }
.layout { display: grid; grid-template-columns: 200px minmax(0, 1fr); gap: 32px; padding: 24px 40px 64px; max-width: 1200px; }
nav { position: sticky; top: 16px; align-self: start; display: grid; gap: 2px; }
nav a { display: flex; justify-content: space-between; padding: 6px 10px; border-radius: 6px; color: inherit; text-decoration: none; }
nav a:hover { background: #efece6; }
nav span, .muted { color: #6e6b66; }
section { margin-bottom: 40px; }
h2 { font-size: 18px; margin: 0 0 4px; }
table { width: 100%; border-collapse: collapse; margin-top: 12px; background: #fff; border: 1px solid #e6e3dd; border-radius: 8px; }
th { text-align: left; font-size: 12px; font-weight: 600; color: #6e6b66; padding: 8px 12px; border-bottom: 1px solid #e6e3dd; }
td { padding: 10px 12px; border-bottom: 1px solid #f0ede8; vertical-align: top; }
tr:last-child td { border-bottom: 0; }
td.pv { width: 72px; }
code { font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; }
.name { font-weight: 600; }
.desc { margin-top: 4px; }
.decision { margin-top: 6px; padding: 6px 8px; background: #fff7e6; border-radius: 6px; font-size: 13px; }
.swatch { display: block; width: 48px; height: 32px; border-radius: 6px; border: 1px solid rgba(0,0,0,.1); }
.radius { display: block; width: 48px; height: 32px; background: #e9e6e0; border: 1px solid #c9c5bd; }
.bar { display: block; width: 100px; height: 8px; background: #f0ede8; border-radius: 4px; overflow: hidden; }
.bar span { display: block; height: 100%; background: #8a8580; }
.sample { display: block; white-space: nowrap; overflow: hidden; max-width: 110px; }
.components { list-style: none; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
.components li { background: #fff; border: 1px solid #e6e3dd; border-radius: 8px; padding: 12px; }
footer { padding: 0 40px 40px; color: #6e6b66; font-size: 12px; }
@media (max-width: 960px) { .layout { grid-template-columns: 1fr; gap: 16px; } nav { position: static; display: flex; flex-wrap: wrap; gap: 4px; } nav a { gap: 6px; background: #efece6; } }
@media (max-width: 600px) { .layout { padding: 16px; } header { padding: 24px 16px 12px; } td.pv { display: none; } }
</style>
</head>
<body>
<header>
<h1>${esc(d.projectName)} design system</h1>
<div class="muted">${d.tokens.length} tokens from <code>${esc(d.sourceUrl)}</code> · run ${d.runNumber} · generated ${esc(
    d.generatedAt.slice(0, 10),
  )}</div>
</header>
<div class="layout">
<nav aria-label="Sections">${nav}</nav>
<main>
${body}
${components}
</main>
</div>
<footer>Generated by Design System Studio from your approved tokens. Do not edit by hand: change the source or the review, then run again.</footer>
</body>
</html>
`;
}

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** A plain catalog for AI agents: what exists, how to use it, and where each value came from. */
export function renderAgentCatalog(d: DocsInput): string {
  const lines = [
    `# ${d.projectName} design system: catalog for agents`,
    '',
    `Generated from approved tokens (run ${d.runNumber}, ${d.generatedAt.slice(0, 10)}). Source: ${d.sourceUrl}`,
    '',
    '## Rules',
    '',
    '- Style with these tokens through their CSS custom properties, for example `color: var(--color-ink)`.',
    '- Never copy a token value into code. If no token fits, say so instead of inventing a value.',
    '- Responsive values switch automatically at the listed widths; do not add your own media queries for them.',
    '',
  ];
  for (const s of sectionsOf(d.tokens)) {
    lines.push(
      `## ${s.title}`,
      '',
      '| Token | CSS variable | Value | Responsive | Description |',
      '| --- | --- | --- | --- | --- |',
    );
    for (const t of s.tokens) {
      lines.push(
        `| ${cell(t.name)} | \`${cell(t.cssVar)}\` | \`${cell(t.css)}\` | ${cell(responsiveText(t))} | ${cell(
          t.description ?? '',
        )} |`,
      );
    }
    lines.push('');
  }
  if (d.components.length) {
    lines.push(
      '## Components found (not generated yet)',
      '',
      'These exist in the source but have no approved spec, so there is no component to import yet.',
      '',
    );
    for (const c of d.components) {
      const extra = [
        c.modifiers.length ? `variants: ${c.modifiers.join(', ')}` : '',
        c.states.length ? `states: ${c.states.join(', ')}` : '',
      ].filter(Boolean);
      lines.push(`- \`${c.id}\`${extra.length ? ` (${extra.join('; ')})` : ''}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
