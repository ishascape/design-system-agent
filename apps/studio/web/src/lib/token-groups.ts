import type { TokenProposal } from './api.ts';

/** Families with more tokens than this start collapsed, so a 400-colour palette is one row. */
export const COLLAPSE_OVER = 12;

/**
 * Groups proposals into families for review: a numbered scale (`--color-red-50`…`-950`) is one
 * family; everything else is grouped by its kind (colour, space, font…).
 */
export function groupTokens(tokens: TokenProposal[]): { key: string; label: string; items: TokenProposal[] }[] {
  const scale = (t: TokenProposal) => t.cssVar.replace(/-\d+$/, '');
  const scaleSize = new Map<string, number>();
  for (const t of tokens) if (scale(t) !== t.cssVar) scaleSize.set(scale(t), (scaleSize.get(scale(t)) ?? 0) + 1);
  const out = new Map<string, { key: string; label: string; items: TokenProposal[] }>();
  for (const t of tokens) {
    const fam = scale(t);
    const isScale = fam !== t.cssVar && (scaleSize.get(fam) ?? 0) >= 3;
    const key = isScale ? fam : `kind:${t.proposedName.split('.')[0]}`;
    const label = isScale ? `${fam}-*` : t.proposedName.split('.')[0]!;
    if (!out.has(key)) out.set(key, { key, label, items: [] });
    out.get(key)!.items.push(t);
  }
  return [...out.values()];
}
