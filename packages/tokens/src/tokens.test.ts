import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { runAudit } from '@dsa/discovery';
import type { TokenCandidate } from '@dsa/registry';
import { TokenMap as TokenMapSchema, isRgbChannels, promoteTokens, toDtcgToken, type TokenMap } from './promote.ts';
import { cssValue, renderCss, type ManifestToken } from './build.ts';

const fixture = fileURLToPath(new URL('../../../tests/fixtures/mini-site', import.meta.url));
const inv = runAudit(fixture, { id: 'mini-site', repo: 'https://example.com/mini', commit: 'b'.repeat(40) });
const map: TokenMap = {
  source: 'mini-site',
  status: 'pending-approval',
  tokens: {
    'color.ink': { from: 'ink', description: 'Text' },
    'space.4': { from: 'space-4' },
    'font.family.sans': { from: 'font-sans' },
    'motion.easing.pen': { from: 'ease-pen' },
  },
};

describe('promoteTokens', () => {
  const out = promoteTokens(inv, map) as Record<string, Record<string, Record<string, unknown>>>;

  it('copies values and provenance from the audit, not from the map', () => {
    expect(out.color!.ink).toMatchObject({
      $type: 'color',
      $value: '#1c1b19',
      $description: 'Text',
      $extensions: {
        'dev.dsa.provenance': { source: 'src/styles/tokens.css:3', sourceVar: '--ink', commit: 'b'.repeat(40) },
      },
    });
  });

  it('keeps responsive overrides and converts font stacks and easings to DTCG shapes', () => {
    expect(out.space!['4']).toMatchObject({
      $value: '28px',
      $extensions: { 'dev.dsa.responsive': [{ minWidth: 600, value: '32px' }] },
    });
    expect((out.font as Record<string, Record<string, unknown>>).family!.sans).toMatchObject({
      $value: ['Poppins', 'system-ui', 'sans-serif'],
    });
    expect((out.motion as Record<string, Record<string, unknown>>).easing!.pen).toMatchObject({
      $value: [0.2, 0, 0, 1],
    });
  });

  it('applies a design decision but keeps the source value in provenance', () => {
    const decided = promoteTokens(inv, {
      ...map,
      tokens: {
        'space.4': {
          from: 'space-4',
          override: { value: '30px', reason: 'Test decision', decidedBy: 'Ashni', date: '2026-11-02' },
        },
      },
    }) as Record<string, Record<string, Record<string, unknown>>>;
    const token = decided.space!['4'] as { $value: string; $extensions: Record<string, Record<string, unknown>> };
    expect(token.$value).toBe('30px');
    expect(token.$extensions['dev.dsa.provenance']).toMatchObject({
      confidence: 'decided',
      sourceValue: '28px',
      decision: { reason: 'Test decision', decidedBy: 'Ashni' },
    });
  });

  it('refuses a design decision without a reason', () => {
    const bad = { from: 'space-4', override: { value: '30px', reason: '', decidedBy: 'Ashni', date: '2026-11-02' } };
    expect(() => TokenMapSchema.parse({ ...map, tokens: { 'space.4': bad } })).toThrow();
  });

  it('refuses a map entry that is not in the audit', () => {
    expect(() => promoteTokens(inv, { ...map, tokens: { 'color.nope': { from: 'nope' } } })).toThrow(/--nope/);
  });

  it('stores clamp() as a fluid token whose static value is the minimum', () => {
    const t = toDtcgToken(
      {
        id: 'text-body',
        type: 'dimension',
        value: 'clamp(16px, 1.4vw, 18px)',
        overrides: [],
        usageCount: 1,
        confidence: 'observed',
        source: { file: 'a.css', line: 1 },
      },
      'c'.repeat(40),
    );
    expect(t.$value).toBe('16px');
    expect(t.$extensions['dev.dsa.fluid']).toEqual({ min: '16px', max: '18px', css: 'clamp(16px, 1.4vw, 18px)' });
  });

  it('refuses types it cannot represent', () => {
    expect(() =>
      toDtcgToken(
        {
          id: 'rule-style',
          type: 'other',
          value: 'solid',
          overrides: [],
          usageCount: 0,
          confidence: 'observed',
          source: { file: 'a.css', line: 1 },
        },
        'c'.repeat(40),
      ),
    ).toThrow(/cannot be promoted/);
  });
});

describe('colour formats', () => {
  const token = (id: string, type: TokenCandidate['type'], value: string, media?: string) =>
    toDtcgToken(
      {
        id,
        type,
        value,
        overrides: media ? [{ media, value: '32px', source: { file: 'a.css', line: 2 } }] : [],
        usageCount: 1,
        confidence: 'observed',
        source: { file: 'a.css', line: 1 },
      },
      'c'.repeat(40),
    );

  it('converts rgb() with alpha, in space or comma syntax, to hex', () => {
    expect(token('marker-wash', 'color', 'rgb(47 95 179 / 0.12)').$value).toBe('#2f5fb31f');
    expect(token('marker-wash', 'color', 'rgba(47, 95, 179, 12%)').$value).toBe('#2f5fb31f');
    expect(token('ink', 'color', 'rgb(28 27 25)').$value).toBe('#1c1b19');
  });

  it('still refuses colour formats it cannot convert', () => {
    expect(() => token('x', 'color', 'hsl(10 20% 30%)')).toThrow(/only hex and rgb/);
  });

  it('stores RGB channel triplets as colours that keep their channel form in CSS', () => {
    const t = token('grid-line', 'other', '216 210 196');
    expect(t).toMatchObject({ $type: 'color', $value: '#d8d2c4' });
    expect(t.$extensions['dev.dsa.cssFormat']).toBe('rgb-channels');
    expect(cssValue({ ...t, name: 'grid-line', path: ['color', 'grid-line'] } as never)).toBe('216 210 196');
    expect(isRgbChannels('300 0 0')).toBe(false);
  });

  it('reads the (width>=600px) range syntax as a min-width override', () => {
    expect(token('space-4', 'dimension', '28px', '(width>=600px)').$extensions['dev.dsa.responsive']).toEqual([
      { minWidth: 600, value: '32px', source: 'a.css:2' },
    ]);
  });
});

describe('renderCss', () => {
  const prov = { source: 'a:1', sourceVar: '--x', commit: 'c', confidence: 'observed' };
  const tokens: ManifestToken[] = [
    {
      name: 'space.4',
      cssVar: '--space-4',
      type: 'dimension',
      value: '28px',
      css: '28px',
      responsive: [{ minWidth: 600, value: '32px' }],
      provenance: prov,
    },
    {
      name: 'motion.duration.micro',
      cssVar: '--motion-duration-micro',
      type: 'duration',
      value: '150ms',
      css: '150ms',
      reducedMotion: '0ms',
      provenance: prov,
    },
  ];
  it('emits base values, min-width overrides and reduced-motion overrides', () => {
    expect(renderCss(tokens, 'test')).toBe(
      `/* test */\n:root {\n  --space-4: 28px;\n  --motion-duration-micro: 150ms;\n}\n\n@media (min-width: 600px) {\n  :root {\n    --space-4: 32px;\n  }\n}\n\n@media (prefers-reduced-motion: reduce) {\n  :root {\n    --motion-duration-micro: 0ms;\n  }\n}\n`,
    );
  });
});
