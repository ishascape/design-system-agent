/**
 * Finds colours and pixel lengths written directly in CSS instead of through a token,
 * and classifies each against the token set:
 * - matches-token: same value as a token (a value match, not proof of the same meaning)
 * - near-token: within a small tolerance of a token, likely drift
 * - one-off: no close token
 */
import postcss from 'postcss';
import type { HardCodedValue, SourceRef, TokenCandidate } from '@dsa/registry';
import type { CssFile } from './tokens.ts';

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const hex2 = (n: number) => Math.round(n).toString(16).padStart(2, '0');

export function parseColor(raw: string): Rgba | undefined {
  const v = raw.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,4})$/.exec(v);
  if (m) {
    const [r, g, b, a = 'f'] = m[1]!.split('');
    return { r: parseInt(r! + r, 16), g: parseInt(g! + g, 16), b: parseInt(b! + b, 16), a: parseInt(a + a, 16) / 255 };
  }
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(v);
  if (m) {
    const h = m[1]!;
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: m[2] ? parseInt(m[2], 16) / 255 : 1,
    };
  }
  m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)\s*(?:[/,]\s*([\d.]+%?))?\s*\)$/.exec(v);
  if (m) {
    const alphaRaw = m[4];
    const a = alphaRaw === undefined ? 1 : alphaRaw.endsWith('%') ? parseFloat(alphaRaw) / 100 : parseFloat(alphaRaw);
    return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a };
  }
  return undefined;
}

/** "#rrggbb", plus " / 45%" when not opaque, so translucent uses of a colour group separately. */
export function normalizeColor(c: Rgba): string {
  const base = `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
  return c.a >= 1 ? base : `${base} / ${Math.round(c.a * 100)}%`;
}

function rgbDistance(a: Rgba, b: Rgba): number {
  return Math.round(Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b) * 10) / 10;
}

/** Colour values found in a declaration value, skipping anything inside var(...). */
export function findColors(value: string): string[] {
  const withoutVars = value.replace(/var\([^)]*\)/g, '');
  const re = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi;
  return [...withoutVars.matchAll(re)].map((m) => m[0]).filter((c) => parseColor(c) !== undefined);
}

/** Pixel lengths in a declaration value, skipping anything inside var(...). 0px is ignored. */
export function findPxLengths(value: string): string[] {
  const withoutVars = value.replace(/var\([^)]*\)/g, '');
  return [...withoutVars.matchAll(/(?<![\w.-])(-?\d*\.?\d+)px\b/g)]
    .map((m) => Math.abs(parseFloat(m[1]!)))
    .filter((n) => n !== 0)
    .map((n) => `${n}px`);
}

const COLOR_NEAR_DISTANCE = 12;
const LENGTH_NEAR_PX = 2;

export function scanHardCoded(
  files: CssFile[],
  tokens: Pick<TokenCandidate, 'id' | 'type' | 'value' | 'overrides'>[],
): HardCodedValue[] {
  const colorTokens = tokens
    .filter((t) => t.type === 'color')
    .flatMap((t) => {
      const c = parseColor(t.value);
      return c ? [{ id: t.id, value: t.value, rgba: c }] : [];
    });
  const pxTokens = tokens
    .filter((t) => t.type === 'dimension')
    .flatMap((t) =>
      [t.value, ...t.overrides.map((o) => o.value)]
        .filter((v) => /^\d*\.?\d+px$/.test(v))
        .map((v) => ({ id: t.id, value: v, px: parseFloat(v) })),
    );

  const groups = new Map<string, { kind: 'color' | 'length'; occurrences: SourceRef[] }>();
  const add = (kind: 'color' | 'length', normalized: string, ref: SourceRef) => {
    const key = `${kind}:${normalized}`;
    const g = groups.get(key) ?? { kind, occurrences: [] };
    if (!g.occurrences.some((o) => o.file === ref.file && o.line === ref.line)) g.occurrences.push(ref);
    groups.set(key, g);
  };

  for (const file of files) {
    const root = postcss.parse(file.content, { from: file.path });
    root.walkDecls((decl) => {
      if (decl.prop.startsWith('--')) return; // token definitions are not drift
      const ref = { file: file.path, line: decl.source?.start?.line ?? 1 };
      for (const c of findColors(decl.value)) add('color', normalizeColor(parseColor(c)!), ref);
      for (const l of findPxLengths(decl.value)) add('length', l, ref);
    });
  }

  const results: HardCodedValue[] = [];
  for (const [key, g] of groups) {
    const normalized = key.slice(key.indexOf(':') + 1);
    let nearest: { id: string; value: string; distance: number } | undefined;
    if (g.kind === 'color') {
      const c = parseColor(normalized.split(' / ')[0]!)!;
      for (const t of colorTokens) {
        const d = rgbDistance(c, t.rgba);
        if (!nearest || d < nearest.distance) nearest = { id: t.id, value: t.value, distance: d };
      }
    } else {
      const px = parseFloat(normalized);
      for (const t of pxTokens) {
        const d = Math.abs(px - t.px);
        if (!nearest || d < nearest.distance) nearest = { id: t.id, value: t.value, distance: d };
      }
    }
    const limit = g.kind === 'color' ? COLOR_NEAR_DISTANCE : LENGTH_NEAR_PX;
    const classification = !nearest
      ? 'one-off'
      : nearest.distance === 0
        ? 'matches-token'
        : nearest.distance <= limit
          ? 'near-token'
          : 'one-off';
    results.push({
      kind: g.kind,
      normalized,
      occurrences: g.occurrences,
      classification,
      ...(nearest && classification !== 'one-off' ? { nearestToken: nearest } : {}),
      confidence: 'inferred',
    });
  }

  return results.sort(
    (a, b) =>
      a.kind.localeCompare(b.kind) ||
      b.occurrences.length - a.occurrences.length ||
      a.normalized.localeCompare(b.normalized),
  );
}
