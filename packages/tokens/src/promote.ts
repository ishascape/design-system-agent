/**
 * Promotes audited token candidates into the canonical DTCG token file.
 *
 * Input: the audit inventory (evidence) + a human-curated token map (names and descriptions).
 * Output: registry/tokens/<source>.tokens.json. Values and provenance always come from the
 * inventory, never from the map, so a canonical value can always be traced to a source line.
 */
import { z } from 'zod';
import type { AuditInventory, TokenCandidate } from '@dsa/registry';

export const TokenMap = z.object({
  source: z.string(),
  status: z.enum(['pending-approval', 'approved']),
  tokens: z.record(
    z.string().regex(/^[a-z]+(\.[a-z0-9-]+)+$/, 'Canonical names are dot paths like "color.ink"'),
    z.object({
      from: z.string().regex(/^[a-z0-9-]+$/),
      description: z.string().optional(),
      /**
       * A design decision that replaces the source value. The source value stays in provenance,
       * so the change from the live site is always visible and reversible.
       */
      override: z
        .object({
          value: z.string(),
          reason: z.string().min(1),
          decidedBy: z.string().min(1),
          date: z.iso.date(),
        })
        .optional(),
    }),
  ),
});
export type TokenMap = z.infer<typeof TokenMap>;

const REDUCED_MOTION = /prefers-reduced-motion:\s*reduce/;
/** `(min-width: 600px)`, or the range syntax `(width>=600px)` that CSS minifiers produce. */
const MIN_WIDTH = /^\((?:min-width:\s*|width\s*>=\s*)(\d+)px\)$/;
const RGB_CHANNELS = /^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})$/;

export interface DtcgToken {
  $type: string;
  $value: unknown;
  $description?: string;
  $extensions: Record<string, unknown>;
}

function parseFontFamily(v: string): string[] {
  return v.split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, ''));
}

function parseCubicBezier(v: string): number[] {
  const m = /^cubic-bezier\(([^)]*)\)$/.exec(v.trim());
  if (!m) throw new Error(`Not a cubic-bezier: ${v}`);
  const nums = m[1]!.split(',').map((n) => Number(n.trim()));
  if (nums.length !== 4 || nums.some(Number.isNaN)) throw new Error(`Invalid cubic-bezier: ${v}`);
  return nums;
}

/** For clamp(min, preferred, max): the min is the static value (used by Figma), the CSS keeps the clamp. */
function parseFluid(v: string): { min: string; max: string; css: string } | undefined {
  const m = /^clamp\(\s*([^,]+),\s*([^,]+),\s*([^)]+)\)$/.exec(v.trim());
  if (!m) return undefined;
  return { min: m[1]!.trim(), max: m[3]!.trim(), css: v.trim() };
}

function normalizeHex(v: string): string {
  const s = v.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${[...s.slice(1)].map((c) => c + c).join('')}`;
  return s;
}

/** Space-separated channels like "216 210 196", written so CSS can use rgb(var(--x) / 0.4). */
export function isRgbChannels(v: string): boolean {
  const m = RGB_CHANNELS.exec(v.trim());
  return !!m && m.slice(1).every((c) => Number(c) <= 255);
}

const hex2 = (n: number) =>
  Math.round(Math.min(255, Math.max(0, n)))
    .toString(16)
    .padStart(2, '0');

/** rgb()/rgba() in comma or space syntax, with an optional alpha, as a hex colour (#rrggbb or #rrggbbaa). */
function rgbToHex(v: string): string | undefined {
  const m = /^rgba?\(([^)]*)\)$/i.exec(v.trim());
  if (!m) return undefined;
  const parts = m[1]!.split(/[\s,/]+/).filter(Boolean);
  if (parts.length !== 3 && parts.length !== 4) return undefined;
  const channel = (p: string) => (p.endsWith('%') ? (Number(p.slice(0, -1)) / 100) * 255 : Number(p));
  const alpha = (p: string) => (p.endsWith('%') ? Number(p.slice(0, -1)) / 100 : Number(p));
  const rgb = parts.slice(0, 3).map(channel);
  const a = parts[3] === undefined ? 1 : alpha(parts[3]);
  if ([...rgb, a].some(Number.isNaN)) return undefined;
  return `#${rgb.map(hex2).join('')}${a < 1 ? hex2(a * 255) : ''}`;
}

export function toDtcgToken(t: TokenCandidate, commit: string, description?: string): DtcgToken {
  const ext: Record<string, unknown> = {
    'dev.dsa.provenance': {
      source: `${t.source.file}:${t.source.line}`,
      sourceVar: `--${t.id}`,
      commit,
      confidence: t.confidence,
    },
  };
  let $type: string;
  let $value: unknown;
  switch (t.type) {
    case 'color': {
      const hex = /^#[0-9a-f]{3,8}$/i.test(t.value.trim()) ? normalizeHex(t.value) : rgbToHex(t.value);
      if (!hex) throw new Error(`--${t.id}: only hex and rgb() colours are supported, got ${t.value}`);
      $type = 'color';
      $value = hex;
      break;
    }
    case 'dimension': {
      $type = 'dimension';
      const fluid = parseFluid(t.value);
      if (fluid) {
        $value = fluid.min;
        ext['dev.dsa.fluid'] = fluid;
      } else $value = t.value.trim();
      break;
    }
    case 'fontFamily':
      $type = 'fontFamily';
      $value = parseFontFamily(t.value);
      break;
    case 'duration':
      $type = 'duration';
      $value = t.value.trim();
      break;
    case 'cubicBezier':
      $type = 'cubicBezier';
      $value = parseCubicBezier(t.value);
      break;
    default:
      if (isRgbChannels(t.value)) {
        // Stored as a normal colour (what Figma and docs need); the CSS keeps the channel form
        // so existing rgb(var(--x) / alpha) uses on the site keep working.
        $type = 'color';
        $value = `#${t.value.trim().split(/\s+/).map(Number).map(hex2).join('')}`;
        ext['dev.dsa.cssFormat'] = 'rgb-channels';
        break;
      }
      throw new Error(`--${t.id} has type "${t.type}", which cannot be promoted yet. Remove it from the token map.`);
  }
  const responsive = t.overrides
    .map((o) => ({ m: MIN_WIDTH.exec(o.media), o }))
    .filter((x) => x.m)
    .map(({ m, o }) => ({ minWidth: Number(m![1]), value: o.value, source: `${o.source.file}:${o.source.line}` }));
  if (responsive.length) ext['dev.dsa.responsive'] = responsive;
  const reduced = t.overrides.find((o) => REDUCED_MOTION.test(o.media));
  if (reduced)
    ext['dev.dsa.reducedMotion'] = { value: reduced.value, source: `${reduced.source.file}:${reduced.source.line}` };
  const unhandled = t.overrides.filter((o) => !MIN_WIDTH.test(o.media) && !REDUCED_MOTION.test(o.media));
  if (unhandled.length)
    throw new Error(
      `--${t.id} has overrides in unsupported media queries: ${unhandled.map((o) => o.media).join(', ')}`,
    );

  return { $type, $value, ...(description ? { $description: description } : {}), $extensions: ext };
}

export function promoteTokens(inv: AuditInventory, map: TokenMap): Record<string, unknown> {
  const byId = new Map(inv.tokens.map((t) => [t.id, t]));
  const missing = Object.entries(map.tokens).filter(([, m]) => !byId.has(m.from));
  if (missing.length) {
    throw new Error(
      `Token map refers to custom properties not found in the audit: ${missing.map(([, m]) => `--${m.from}`).join(', ')}`,
    );
  }
  const out: Record<string, unknown> = {
    $description: `Canonical tokens for ${map.source}. Generated from audits/${map.source}/inventory.json and registry/tokens/${map.source}.token-map.json. Do not edit by hand.`,
    $extensions: { 'dev.dsa.registry': { source: map.source, commit: inv.source.commit, status: map.status } },
  };
  for (const [name, m] of Object.entries(map.tokens).sort(([a], [b]) => a.localeCompare(b))) {
    const path = name.split('.');
    let node = out;
    for (const seg of path.slice(0, -1)) node = (node[seg] ??= {}) as Record<string, unknown>;
    const source = byId.get(m.from)!;
    if (!m.override) {
      node[path.at(-1)!] = toDtcgToken(source, inv.source.commit, m.description);
      continue;
    }
    const token = toDtcgToken({ ...source, value: m.override.value }, inv.source.commit, m.description);
    const prov = token.$extensions['dev.dsa.provenance'] as Record<string, unknown>;
    token.$extensions['dev.dsa.provenance'] = {
      ...prov,
      confidence: 'decided',
      sourceValue: source.value.trim(),
      decision: m.override,
    };
    node[path.at(-1)!] = token;
  }
  return out;
}
