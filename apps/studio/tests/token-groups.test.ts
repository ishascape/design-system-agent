import { describe, expect, it } from 'vitest';
import { groupTokens } from '../web/src/lib/token-groups.ts';
import type { TokenProposal } from '../web/src/lib/api.ts';

const t = (cssVar: string, proposedName: string): TokenProposal => ({
  cssVar,
  proposedName,
  type: 'color',
  value: '#000',
  usageCount: 1,
  source: 'a.css:1',
  promotable: true,
});

describe('groupTokens', () => {
  it('puts a numbered scale in one family and the rest by kind', () => {
    const scale = [50, 100, 200, 300].map((n) => t(`--red-${n}`, `color.red-${n}`));
    const groups = groupTokens([...scale, t('--ink', 'color.ink'), t('--space-4', 'space.4')]);
    expect(groups.map((g) => [g.label, g.items.length])).toEqual([
      ['--red-*', 4],
      ['color', 1],
      ['space', 1],
    ]);
  });

  it('does not make a family out of fewer than three numbered tokens', () => {
    const groups = groupTokens([t('--space-2', 'space.2'), t('--space-4', 'space.4')]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.label).toBe('space');
  });
});
