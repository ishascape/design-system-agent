/**
 * Reads CSS custom properties declared on `:root` and turns them into token candidates.
 * Values inside media queries become responsive overrides of the base token.
 *
 * Source CSS is parsed, never executed.
 */
import postcss, { type AtRule, type Declaration, type Rule } from 'postcss';
import type { ResponsiveOverride, TokenCandidate, TokenType } from '@dsa/registry';

export interface CssFile {
  /** Path relative to the repo root, forward slashes. */
  path: string;
  content: string;
}

/** Guess a DTCG type from a raw CSS value. Unknown shapes become "other" rather than a wrong guess. */
export function inferTokenType(value: string): TokenType {
  const v = value.trim().toLowerCase();
  if (/^#[0-9a-f]{3,8}$/.test(v) || /^(rgb|rgba|hsl|hsla)\(/.test(v)) return 'color';
  if (isChannelTriplet(v)) return 'color';
  if (/^cubic-bezier\(/.test(v)) return 'cubicBezier';
  if (/^-?\d*\.?\d+m?s$/.test(v)) return 'duration';
  if (/^-?\d*\.?\d+(px|rem|em|ch|vw|vh|%)$/.test(v) || /^(clamp|min|max|calc)\(/.test(v)) return 'dimension';
  if (/^-?\d*\.?\d+$/.test(v)) return 'number';
  if (/['"]/.test(v) || /(sans-serif|serif|monospace|cursive|system-ui)\b/.test(v)) return 'fontFamily';
  return 'other';
}

/**
 * Bare RGB channels like `216 210 196` or `216, 210, 196`, stored so CSS can add alpha with
 * `rgb(var(--x) / 0.5)`. Three unitless integers up to 255 are not valid as anything else in CSS.
 */
export function isChannelTriplet(value: string): boolean {
  const m = /^(\d{1,3})(?:\s*,\s*|\s+)(\d{1,3})(?:\s*,\s*|\s+)(\d{1,3})$/.exec(value.trim());
  return !!m && [m[1], m[2], m[3]].every((n) => Number(n) <= 255);
}

function isRootRule(rule: Rule): boolean {
  return rule.selectors.some((s) => s.trim() === ':root');
}

/** The enclosing @media params, or undefined for a top-level rule. */
function mediaOf(rule: Rule): string | undefined {
  const parent = rule.parent;
  if (parent && parent.type === 'atrule' && (parent as AtRule).name === 'media') {
    return (parent as AtRule).params.trim();
  }
  return undefined;
}

/** A trailing comment on the same line as the declaration, e.g. `--x: 1px; /* why *\/`. */
function trailingComment(decl: Declaration): string | undefined {
  const next = decl.next();
  if (next && next.type === 'comment' && next.source?.start?.line === decl.source?.start?.line) {
    return next.text.trim();
  }
  return undefined;
}

export function parseTokens(files: CssFile[]): Omit<TokenCandidate, 'usageCount'>[] {
  const base = new Map<string, Omit<TokenCandidate, 'usageCount'>>();
  const overrides: { id: string; override: ResponsiveOverride }[] = [];

  for (const file of files) {
    const root = postcss.parse(file.content, { from: file.path });
    root.walkRules((rule) => {
      if (!isRootRule(rule)) return;
      const media = mediaOf(rule);
      rule.each((node) => {
        if (node.type !== 'decl' || !node.prop.startsWith('--')) return;
        const id = node.prop.slice(2);
        const source = { file: file.path, line: node.source?.start?.line ?? 1 };
        const value = node.value.trim();
        if (media) {
          overrides.push({ id, override: { media, value, source } });
          return;
        }
        if (base.has(id)) return; // first declaration wins; duplicates are reported by drift later
        const comment = trailingComment(node);
        base.set(id, {
          id,
          type: inferTokenType(value),
          value,
          overrides: [],
          // The type of bare channels is a judgement, not something the CSS states.
          confidence: isChannelTriplet(value) ? 'inferred' : 'observed',
          source,
          ...(comment ? { comment } : {}),
        });
      });
    });
  }

  for (const { id, override } of overrides) {
    base.get(id)?.overrides.push(override);
  }
  return [...base.values()];
}

/** Count `var(--id)` references in any text (CSS or TSX). */
export function countVarUsage(texts: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  const re = /var\(\s*--([a-z0-9-]+)/gi;
  for (const text of texts) {
    for (const m of text.matchAll(re)) {
      const id = m[1]!.toLowerCase();
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return counts;
}
