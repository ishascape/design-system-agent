import { describe, expect, it } from 'vitest';
import type { ManifestToken } from '@dsa/tokens';
import { renderAgentCatalog, renderDocsSite, sectionsOf, type DocsInput } from '../server/generate/docs-site.ts';
import { validateOutputs } from '../server/generate/validate.ts';

const tok = (name: string, type: string, css: string, extra: Partial<ManifestToken> = {}): ManifestToken => ({
  name,
  cssVar: `--${name.replace(/\./g, '-')}`,
  type,
  value: css,
  css,
  provenance: {
    source: 'a.css:1',
    sourceVar: `--${name.split('.').pop()}`,
    commit: 'c'.repeat(40),
    confidence: 'observed',
  },
  ...extra,
});

const tokens = [
  tok('color.ink', 'color', '#1c1b19'),
  tok('space.4', 'dimension', '24px', { responsive: [{ minWidth: 600, value: '28px' }] }),
  tok('font.family.sans', 'fontFamily', "'Poppins', sans-serif"),
  tok('motion.duration.micro', 'duration', '150ms'),
];
const css = `:root {\n${tokens.map((t) => `  ${t.cssVar}: ${t.css};`).join('\n')}\n}\n`;
const input = (over: Partial<DocsInput> = {}): DocsInput => ({
  projectName: 'Portfolio',
  sourceUrl: 'https://example.com',
  runNumber: 3,
  generatedAt: '2026-11-02T00:00:00.000Z',
  tokens,
  tokensCss: css,
  components: [{ id: 'card', uses: 3, modifiers: ['wide'], states: ['hover'], elements: ['a'], onPage: true }],
  ...over,
});

describe('docs site', () => {
  it('groups tokens into sections', () => {
    expect(sectionsOf(tokens).map((s) => [s.key, s.tokens.length])).toEqual([
      ['color', 1],
      ['type', 1],
      ['space', 1],
      ['motion', 1],
    ]);
  });

  it('documents every token with its value, responsive steps and source', () => {
    const html = renderDocsSite(input());
    for (const t of tokens) expect(html).toContain(`id="${t.name}"`);
    expect(html).toContain('28px from 600px');
    expect(html).toContain('From <code>--4</code> at a.css:1');
    expect(html).toContain('3 times on the page');
  });

  it('shows channel colours with a real swatch and how to use them', () => {
    const grid = tok('color.grid-line', 'color', '216 210 196', { value: '#d8d2c4' });
    const html = renderDocsSite(input({ tokens: [grid] }));
    expect(html).toContain('style="background:#d8d2c4"');
    expect(html).toContain('rgb(var(--color-grid-line) / 0.5)');
  });

  it('escapes source text and cannot be broken out of by a hostile value', () => {
    const evil = tok('font.family.evil', 'fontFamily', '"</style><script>alert(1)</script>"', {
      description: '<img src=x onerror=alert(1)>',
    });
    const html = renderDocsSite(
      input({ projectName: '<b>x</b>', tokens: [evil], tokensCss: `:root { --font-family-evil: ${evil.css}; }` }),
    );
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect((html.match(/<\/style>/g) ?? []).length).toBe(2); // only the generator's own two blocks
    expect(
      validateOutputs({ approvedCount: 1, manifest: [evil], tokensCss: '', docsHtml: html }).find(
        (c) => c.name === 'Docs page contains no scripts',
      )?.status,
    ).toBe('pass');
  });

  it('writes an agent catalog that names every CSS variable', () => {
    const md = renderAgentCatalog(input());
    for (const t of tokens) expect(md).toContain(`\`${t.cssVar}\``);
    expect(md).toContain('Never copy a token value into code');
    expect(md).toContain('`card` (variants: wide; states: hover)');
  });
});

describe('validation', () => {
  const html = renderDocsSite(input());
  const catalog = renderAgentCatalog(input());

  it('passes generated outputs and reports Figma as not run, never as passed', () => {
    const checks = validateOutputs({
      approvedCount: 4,
      manifest: tokens,
      tokensCss: css,
      docsHtml: html,
      catalog,
      figma: { notRun: 'Not built yet' },
    });
    expect(checks.filter((c) => c.status !== 'pass').map((c) => [c.name, c.status])).toEqual([
      ['Figma matches the tokens', 'not-run'],
    ]);
  });

  it('fails when a token is missing from the CSS, the docs or the catalog, or was not built', () => {
    const checks = validateOutputs({
      approvedCount: 5,
      manifest: tokens,
      tokensCss: css.replace(/ {2}--space-4: 24px;\n/, ''),
      docsHtml: html.replace('id="color.ink"', ''),
      catalog: catalog.replace('`--motion-duration-micro`', ''),
    });
    const failed = Object.fromEntries(checks.filter((c) => c.status === 'fail').map((c) => [c.name, c.detail]));
    expect(failed['Every approved token was built']).toBe('4 built, 5 approved');
    expect(failed['CSS declares every token once']).toMatch(/missing --space-4/);
    expect(failed['Docs cover every token']).toMatch(/color\.ink/);
    expect(failed['Agent catalog covers every token']).toMatch(/--motion-duration-micro/);
  });

  it('reports a token declared twice', () => {
    const checks = validateOutputs({
      approvedCount: 4,
      manifest: tokens,
      tokensCss: css + ':root { --color-ink: red; }',
    });
    expect(checks.find((c) => c.name === 'CSS declares every token once')?.detail).toMatch(
      /declared twice --color-ink/,
    );
  });
});
