import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { AuditInventory } from '@dsa/registry';
import { inferTokenType, parseTokens, countVarUsage } from './tokens.ts';
import { findColors, findPxLengths, normalizeColor, parseColor } from './drift.ts';
import { blockKind, findClassUsages, parseBem } from './components.ts';
import { runAudit } from './audit.ts';
import { renderComponentsReport, renderDriftReport, toDtcgCandidates } from './report.ts';

const fixture = fileURLToPath(new URL('../../../tests/fixtures/mini-site', import.meta.url));
const source = { id: 'mini-site', repo: 'https://example.com/mini-site', commit: 'a'.repeat(40) };

describe('token parsing', () => {
  it('infers DTCG types and refuses to guess unknown shapes', () => {
    expect(inferTokenType('#f5f2ea')).toBe('color');
    expect(inferTokenType('216 210 196')).toBe('color');
    expect(inferTokenType('216, 210, 196')).toBe('color');
    expect(inferTokenType('1 2 300')).toBe('other');
    expect(inferTokenType('clamp(16px, 1.4vw, 18px)')).toBe('dimension');
    expect(inferTokenType('150ms')).toBe('duration');
    expect(inferTokenType('cubic-bezier(0.2, 0, 0, 1)')).toBe('cubicBezier');
    expect(inferTokenType("'Poppins', system-ui")).toBe('fontFamily');
  });

  it('reads :root tokens with source lines, comments and media overrides', () => {
    const tokens = parseTokens([
      {
        path: 't.css',
        content: ':root {\n  --a: 4px; /* why */\n}\n@media (min-width: 600px) {\n  :root { --a: 8px; }\n}',
      },
    ]);
    expect(tokens).toEqual([
      {
        id: 'a',
        type: 'dimension',
        value: '4px',
        comment: 'why',
        confidence: 'observed',
        source: { file: 't.css', line: 2 },
        overrides: [{ media: '(min-width: 600px)', value: '8px', source: { file: 't.css', line: 5 } }],
      },
    ]);
  });

  it('counts var() usage', () => {
    expect(countVarUsage(['color: var(--ink); background: var( --ink )', 'var(--paper)'])).toEqual(
      new Map([
        ['ink', 2],
        ['paper', 1],
      ]),
    );
  });
});

describe('hard-coded values', () => {
  it('parses and normalises colours', () => {
    expect(normalizeColor(parseColor('#FFF')!)).toBe('#ffffff');
    expect(normalizeColor(parseColor('rgb(97 94 88 / 0.45)')!)).toBe('#615e58 / 45%');
    expect(normalizeColor(parseColor('rgba(0, 0, 0, 0.7)')!)).toBe('#000000 / 70%');
    expect(parseColor('not-a-colour')).toBeUndefined();
  });

  it('ignores values inside var() and zero lengths', () => {
    expect(findColors('var(--x, #fff) #000')).toEqual(['#000']);
    expect(findPxLengths('0px 1px var(--y, 4px) -2px 0.5px')).toEqual(['1px', '2px', '0.5px']);
  });
});

describe('component discovery', () => {
  it('splits BEM names', () => {
    expect(parseBem('button--primary')).toEqual({ block: 'button', modifier: 'primary' });
    expect(parseBem('card__tags')).toEqual({ block: 'card', element: 'tags' });
  });

  it('classifies state and SVG classes as non-components', () => {
    expect(blockKind('is-open', ['li'])).toBe('state');
    expect(blockKind('f', ['path', 'circle'])).toBe('graphic');
    expect(blockKind('button', ['a', 'svg'])).toBe('component');
  });

  it('reads static class names from literals and templates, with element and line', () => {
    const usages = findClassUsages({
      path: 'X.tsx',
      content: 'const X = () => (\n  <a className={`button ${p ? "button--primary" : ""}`} />\n);',
    });
    expect(usages).toEqual([
      { className: 'button', element: 'a', ref: { file: 'X.tsx', line: 2 } },
      { className: 'button--primary', element: 'a', ref: { file: 'X.tsx', line: 2 } },
    ]);
  });
});

describe('end-to-end audit of the fixture site', () => {
  const inv = runAudit(fixture, source);

  it('produces a schema-valid inventory', () => {
    expect(() => AuditInventory.parse(inv)).not.toThrow();
    expect(inv.scanned).toEqual({ cssFiles: 2, componentFiles: 2 });
  });

  it('finds the button as a reusable candidate with variants, states and the span misuse', () => {
    const button = inv.components.find((c) => c.id === 'button')!;
    expect(button).toMatchObject({
      kind: 'component',
      reusable: true,
      usedIn: ['src/components/Hero.tsx', 'src/components/Work.tsx'],
      elements: ['a', 'button', 'span'],
      modifiers: ['primary'],
      states: ['focus-visible', 'hover'],
    });
    expect(button.notes[0]).toContain('span');
  });

  it('classifies drift against tokens', () => {
    const byValue = Object.fromEntries(inv.hardCoded.map((h) => [h.normalized, h]));
    expect(byValue['#1c1b19']?.classification).toBe('matches-token');
    expect(byValue['#1b1b1b']).toMatchObject({ classification: 'near-token', nearestToken: { id: 'ink' } });
    expect(byValue['15px']).toMatchObject({ classification: 'near-token', nearestToken: { id: 'radius' } });
    expect(byValue['8px']?.classification).toBe('matches-token');
    expect(byValue['#000000']?.classification).toBe('one-off');
  });

  it('records responsive overrides and usage counts', () => {
    const space4 = inv.tokens.find((t) => t.id === 'space-4')!;
    expect(space4.overrides.map((o) => o.value)).toEqual(['32px']);
    expect(space4.usageCount).toBe(1);
  });

  it('renders deterministic reports (golden files)', async () => {
    await expect(renderDriftReport(inv)).toMatchFileSnapshot('../../../tests/golden/mini-site/drift-report.md');
    await expect(renderComponentsReport(inv)).toMatchFileSnapshot('../../../tests/golden/mini-site/components.md');
    await expect(JSON.stringify(toDtcgCandidates(inv), null, 2)).toMatchFileSnapshot(
      '../../../tests/golden/mini-site/tokens-candidates.tokens.json',
    );
  });
});

describe('file listing', () => {
  it('skips minified copies so values are not counted twice', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { listFiles } = await import('./audit.ts');
    const dir = mkdtempSync(join(tmpdir(), 'list-'));
    writeFileSync(join(dir, 'pico.css'), ':root{--a:1px}');
    writeFileSync(join(dir, 'pico.min.css'), ':root{--a:1px}');
    expect(listFiles(dir, ['.css'])).toEqual(['pico.css']);
  });
});
