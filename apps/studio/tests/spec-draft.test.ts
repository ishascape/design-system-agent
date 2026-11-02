import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runAudit } from '@dsa/discovery';
import { draftComponentSpec } from '../server/generate/spec-draft.ts';

const fixture = fileURLToPath(new URL('../../../tests/fixtures/mini-site', import.meta.url));
const inv = runAudit(fixture, { id: 'mini', repo: 'https://example.com/mini', commit: 'a'.repeat(40) });
const css = ['src/styles/global.css', 'src/styles/tokens.css'].map((p) => ({
  path: p,
  content: readFileSync(`${fixture}/${p}`, 'utf8'),
}));
// An approved map where --radius was left out of the design system.
const names = { ink: 'color.ink', 'space-4': 'space.4', paper: 'color.paper' };

describe('component spec draft', () => {
  const button = inv.components.find((c) => c.id === 'button')!;
  const d = draftComponentSpec(button, css, names, { id: 'mini', commit: 'a'.repeat(40) });

  it('fills in only what the evidence shows, with confidence', () => {
    expect(d).toMatchObject({ id: 'button', name: 'Button', status: 'pending-approval' });
    expect(d.variants.map((v) => [v.name, v.confidence])).toEqual([
      ['default', 'observed'],
      ['primary', 'observed'],
    ]);
    expect(d.variants[1]!.description).toBe('Changes background → color.ink.');
    expect(d.states.map((s) => s.name)).toEqual(['default', 'hover', 'focus-visible']);
    expect(d.tokens).toEqual([
      { name: 'color.ink', usedFor: 'text colour; background (primary)' },
      { name: 'space.4', usedFor: 'spacing' },
    ]);
    expect(d.source.usages).toHaveLength(3);
    expect(d.accessibility.elements).toEqual(['a', 'button', 'span']);
  });

  it('points out gaps instead of hiding them', () => {
    expect(d.unapprovedVars).toEqual(['--radius']);
    expect(d.hardCoded.map((h) => `${h.property}: ${h.value}`)).toEqual([
      'background: #1c1b19',
      'border: 1px solid rgb(28 27 25 / 0.5)',
    ]);
    expect(d.needsYou).toEqual([
      'A one-line summary of what it is for',
      'When to use it, and when not to',
      'Do and don’t guidelines',
      'How it behaves with the keyboard',
      'Whether to approve these as tokens, or replace them: --radius',
      'For each fixed value, a token or a reason it stays fixed (2)',
    ]);
  });

  it('notices a component that uses no approved tokens', () => {
    const card = inv.components.find((c) => c.id === 'card')!;
    const c = draftComponentSpec(card, css, names, { id: 'mini', commit: 'a'.repeat(40) });
    expect(c.tokens).toEqual([]);
    expect(c.needsYou).toContain('Which tokens it should use: its CSS uses none of the approved tokens');
    expect(c.hardCoded.length).toBeGreaterThan(0);
  });
});
