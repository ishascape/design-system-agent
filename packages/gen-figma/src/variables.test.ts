import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  VariablesReadback,
  buildVariablesPayload,
  checkVariablesReadback,
  renderVariablesScript,
  type VariablesPayload,
} from './variables.ts';
import type { ManifestToken } from './generate.ts';

const fixture = (f: string) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));
const tok = (name: string, type: string, value: unknown, extra: Partial<ManifestToken> = {}): ManifestToken => ({
  name,
  cssVar: `--${name.replace(/\./g, '-')}`,
  type,
  value,
  css: String(value),
  provenance: { source: 'a.css:1' },
  ...extra,
});

describe('project variables', () => {
  const p = buildVariablesPayload(
    [
      tok('color.ink', 'color', '#1c1b19'),
      tok('color.veil', 'color', '#00000080'),
      tok('color.odd', 'color', 'hsl(1 2% 3%)'),
      tok('margin.page', 'dimension', '2rem'),
      tok('space.4', 'dimension', '24px', { responsive: [{ minWidth: 600, value: '28px' }] }),
      tok('width.prose', 'dimension', '60ch'),
      tok('font.family.sans', 'fontFamily', ['Poppins', 'system-ui']),
      tok('motion.duration.micro', 'duration', '150ms'),
    ],
    'Portfolio',
  );
  const by = Object.fromEntries(p.variables.map((v) => [v.name, v]));

  it('maps every type Figma can hold, with scopes and the CSS variable', () => {
    expect(by['color.ink']).toMatchObject({ figmaName: 'color/ink', figmaType: 'COLOR', value: '#1c1b19' });
    expect(by['color.veil']!.value).toBe('#00000080');
    expect(by['margin.page']).toMatchObject({ figmaType: 'FLOAT', value: 32, scopes: ['WIDTH_HEIGHT', 'GAP'] });
    expect(by['space.4']).toMatchObject({ value: 24, scopes: ['GAP'] });
    expect(by['space.4']!.description).toContain('28px from 600px');
    expect(by['font.family.sans']).toMatchObject({ figmaType: 'STRING', value: 'Poppins', scopes: ['FONT_FAMILY'] });
    expect(p.variables.every((v) => v.scopes.length && !v.scopes.includes('ALL_SCOPES'))).toBe(true);
  });

  it('lists what cannot go to Figma, with a reason, instead of failing', () => {
    expect(p.skipped).toEqual([
      { name: 'color.odd', reason: 'hsl(1 2% 3%) is not a hex colour' },
      { name: 'width.prose', reason: '60ch is not a px or rem length, which Figma needs' },
      { name: 'motion.duration.micro', reason: 'Figma variables have no duration type' },
    ]);
  });

  it('renders a script that compiles as a use_figma body', () => {
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
    expect(() => new AsyncFunction(renderVariablesScript(p))).not.toThrow();
  });
});

describe('checkVariablesReadback', () => {
  // Both files are real: the payload from the ashnidave tokens, and what Figma returned after
  // the script ran in the test file (2026-11-02).
  const payload = fixture('variables-payload.json') as VariablesPayload;
  const rb = VariablesReadback.parse(fixture('variables-readback.json'));

  it('accepts the verified Figma result (Figma reorders scopes; that is fine)', () => {
    expect(checkVariablesReadback(payload, rb)).toEqual([]);
  });

  it('catches a missing variable, a wrong value, wrong scopes and missing code syntax', () => {
    const broken = structuredClone(rb);
    broken.variables = broken.variables.filter((v) => v.name !== 'color/marker');
    broken.variables.find((v) => v.name === 'space/4')!.value = 30;
    broken.variables.find((v) => v.name === 'radius/default')!.scopes = ['ALL_SCOPES'];
    broken.variables.find((v) => v.name === 'line/hair')!.web = null;
    expect(checkVariablesReadback(payload, broken)).toEqual([
      'color/marker is missing in Figma',
      'line/hair code syntax is missing, expected var(--line-hair)',
      'radius/default scopes are ALL_SCOPES, expected CORNER_RADIUS',
      'space/4 is 30, expected 28',
    ]);
  });
});
