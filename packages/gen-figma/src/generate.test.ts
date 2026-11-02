import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ComponentSpec } from '@dsa/registry';
import {
  FigmaMap,
  buildPayload,
  checkReadback,
  renderSyncScript,
  toFigmaVariables,
  type ManifestToken,
  type Readback,
} from './generate.ts';

const root = process.cwd();
const json = (p: string) => JSON.parse(readFileSync(join(root, p), 'utf8')) as unknown;
const tokens = json('packages/tokens/dist/tokens.manifest.json') as ManifestToken[];
const spec = ComponentSpec.parse(json('registry/components/button.json'));
const map = FigmaMap.parse(json('registry/figma-map.json'));
const payload = buildPayload(tokens, spec, map);
const fixture = (name: string) => (json(`tests/fixtures/figma/${name}`) as { readback: Readback }).readback;

describe('toFigmaVariables', () => {
  const vars = toFigmaVariables(tokens);
  const byName = Object.fromEntries(vars.map((v) => [v.name, v]));

  it('skips tokens Figma variables cannot hold (motion)', () => {
    expect(vars.some((v) => v.name.startsWith('motion.'))).toBe(false);
  });

  it('never leaves a variable on ALL_SCOPES and always sets the CSS var', () => {
    for (const v of vars) {
      expect(v.scopes.length).toBeGreaterThan(0);
      expect(v.scopes).not.toContain('ALL_SCOPES');
      expect(v.cssVar).toMatch(/^--[a-z0-9-]+$/);
    }
  });

  it('stores the minimum of fluid tokens and explains it', () => {
    expect(byName['font.size.body']).toMatchObject({ figmaType: 'FLOAT', value: 16 });
    expect(byName['font.size.body']!.description).toContain('clamp(16px, 1.4vw, 18px)');
  });

  it('explains design decisions that replace the source value', () => {
    expect(byName['line.building']).toMatchObject({ value: 1 });
    expect(byName['line.building']!.description).toContain('Design decision (Ashni, 2026-11-02)');
    expect(byName['line.building']!.description).toContain('Source had 1.5px');
  });

  it('keeps provenance in the description', () => {
    expect(byName['color.ink']!.description).toMatch(/Source: src\/styles\/tokens\.css:\d+/);
  });

  it('rejects colours Figma sync cannot express', () => {
    const bad = { ...tokens.find((t) => t.name === 'color.ink')!, value: 'rgb(0 0 0)' };
    expect(() => toFigmaVariables([bad])).toThrow(/#rrggbb/);
  });
});

describe('buildPayload', () => {
  it('derives variants and states from the registry spec', () => {
    expect(payload.button.variants).toEqual(['Outline', 'Primary']);
    expect(payload.button.states).toEqual(['Default', 'Hover', 'Focus', 'Disabled']);
  });

  it('includes every token the Button uses that Figma can hold', () => {
    const synced = new Set(payload.variables.map((v) => v.name));
    const needed = spec.tokens.map((t) => t.name).filter((n) => !n.startsWith('motion.'));
    expect(needed.filter((n) => !synced.has(n))).toEqual([]);
  });

  it('passes known Figma ids so the script updates in place', () => {
    expect(payload.ids.componentSet).toBe(map.components.button!.componentSet);
    expect(payload.ids.variables['color.ink']).toBe(map.variables['color.ink']);
  });
});

describe('renderSyncScript', () => {
  it('produces JavaScript that compiles as a use_figma body (top-level await and return)', () => {
    const script = renderSyncScript(payload);
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...args: string[]) => unknown;
    expect(() => new AsyncFunction('figma', script)).not.toThrow();
    expect(script.startsWith('const PAYLOAD = ')).toBe(true);
  });
});

describe('checkReadback', () => {
  it('accepts the verified Figma result', () => {
    expect(checkReadback(payload, fixture('result-pass.json'))).toEqual([]);
  });

  it('catches the real Primary-unfilled bug from the first run', () => {
    const problems = checkReadback(payload, fixture('result-primary-unfilled.json'));
    expect(problems).toContain('Variant=Primary, State=Default fill: expected "color/ink", got "none"');
    expect(problems).toContain('Variant=Primary, State=Default label.fill: expected "color/paper", got "color/ink"');
  });

  it('catches paints whose fallback colour is stale (renders black in Figma)', () => {
    const rb = structuredClone(fixture('result-pass.json'));
    rb.variants[1]!.stalePaints = ['Variant=Outline, State=Hover.fills'];
    expect(checkReadback(payload, rb)).toEqual([
      'Variant=Outline, State=Hover stalePaints: expected [], got ["Variant=Outline, State=Hover.fills"]',
    ]);
  });

  it('catches a missing variant and a wrong component type', () => {
    const rb = structuredClone(fixture('result-pass.json'));
    rb.componentSet.type = 'FRAME';
    rb.variants.pop();
    const problems = checkReadback(payload, rb);
    expect(problems[0]).toMatch(/Expected a COMPONENT_SET/);
    expect(problems.some((p) => p.startsWith('Variant list'))).toBe(true);
  });
});
