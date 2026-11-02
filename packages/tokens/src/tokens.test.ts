import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { runAudit } from '@dsa/discovery';
import {
  TokenMap as TokenMapSchema,
  minWidthOf,
  parseColor,
  promoteTokens,
  promotionBlocker,
  toDtcgToken,
  type TokenMap,
} from './promote.ts';
import type { TokenCandidate } from '@dsa/registry';
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
          id: 'layout',
          type: 'other',
          value: 'auto',
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

const cand = (over: Partial<TokenCandidate>): TokenCandidate => ({
  id: 'x',
  type: 'dimension',
  value: '16px',
  overrides: [],
  usageCount: 1,
  confidence: 'observed',
  source: { file: 'a.css', line: 1 },
  ...over,
});

describe('media queries', () => {
  it('reads classic and range forms of "from this width up"', () => {
    expect(minWidthOf('(min-width: 600px)')).toBe(600);
    expect(minWidthOf('(width>=600px)')).toBe(600);
    expect(minWidthOf('(width >= 1024px)')).toBe(1024);
    expect(minWidthOf('(600px <= width)')).toBe(600);
    expect(minWidthOf('only screen and (min-width: 40em)')).toBe(640);
  });
  it('does not guess at queries with a different meaning', () => {
    expect(minWidthOf('(max-width: 600px)')).toBeUndefined();
    expect(minWidthOf('(width > 600px)')).toBeUndefined();
    expect(minWidthOf('(min-width: 600px) and (max-width: 900px)')).toBeUndefined();
    expect(minWidthOf('print')).toBeUndefined();
  });
  it('promotes range-syntax overrides as responsive values (the ashnidave.com case)', () => {
    const t = toDtcgToken(
      cand({
        id: 'space-4',
        value: '24px',
        overrides: [
          { media: '(width>=600px)', value: '28px', source: { file: 'a.css', line: 9 } },
          { media: '(width>=1024px)', value: '32px', source: { file: 'a.css', line: 14 } },
        ],
      }),
      'c'.repeat(40),
    );
    expect(t.$extensions['dev.dsa.responsive']).toEqual([
      { minWidth: 600, value: '28px', source: 'a.css:9' },
      { minWidth: 1024, value: '32px', source: 'a.css:14' },
    ]);
  });
  it('explains an unsupported query instead of failing silently', () => {
    const reason = promotionBlocker(
      cand({ overrides: [{ media: '(max-width: 600px)', value: '8px', source: { file: 'a.css', line: 2 } }] }),
    );
    expect(reason).toMatch(/@media \(max-width: 600px\)/);
  });
});

describe('colours', () => {
  it('reads hex, rgb() and bare channels', () => {
    expect(parseColor('#ABC')).toEqual({ hex: '#aabbcc' });
    expect(parseColor('rgb(216, 210, 196)')).toEqual({ hex: '#d8d2c4' });
    expect(parseColor('rgb(0 0 0 / 50%)')).toEqual({ hex: '#00000080' });
    expect(parseColor('216 210 196')).toEqual({ hex: '#d8d2c4', channels: '216 210 196' });
    expect(parseColor('300 0 0')).toBeUndefined();
    expect(parseColor('hsl(10 20% 30%)')).toBeUndefined();
  });
  it('keeps bare channels in the generated CSS so rgb(var(--x) / a) still works', () => {
    const t = toDtcgToken(cand({ id: 'grid-line', type: 'color', value: '216 210 196' }), 'c'.repeat(40));
    expect(t.$value).toBe('#d8d2c4');
    expect(t.$extensions['dev.dsa.channels']).toBe('216 210 196');
    expect(cssValue(t as unknown as Parameters<typeof cssValue>[0])).toBe('216 210 196');
  });
  it('gives a plain reason for values it cannot read', () => {
    expect(promotionBlocker(cand({ type: 'color', value: 'hsl(10 20% 30%)' }))).toMatch(/hex and rgb/);
    expect(promotionBlocker(cand({ type: 'other', value: 'var(--ink)' }))).toMatch(/points at another variable/);
    expect(promotionBlocker(cand({}))).toBeUndefined();
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
