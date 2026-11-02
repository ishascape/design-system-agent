/**
 * Figma variables for any project's tokens (not only the Button slice). Builds a payload the
 * Studio's Figma plugin, or the Figma MCP `use_figma` tool, applies; then checks the read-back.
 *
 * Unlike the Button sync, nothing here throws on an unusual token: tokens Figma cannot hold are
 * returned in `skipped` with a plain reason, so the person sees exactly what did not go to Figma.
 */
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { FigmaVariable, ManifestToken } from './generate.ts';

export interface SkippedToken {
  name: string;
  reason: string;
}

export interface VariablesPayload {
  kind: 'dsa-figma-variables';
  version: 1;
  collectionName: string;
  variables: FigmaVariable[];
  skipped: SkippedToken[];
}

const BY_NAME: [RegExp, string[]][] = [
  [/^space\./, ['GAP']],
  [/^radius\./, ['CORNER_RADIUS']],
  [/^line\./, ['STROKE_FLOAT']],
  [/^(size|layout)\./, ['WIDTH_HEIGHT', 'GAP']],
  [/^font\.size\./, ['FONT_SIZE']],
  [/^(font\.)?line-height\./, ['LINE_HEIGHT']],
];

function scopesFor(t: ManifestToken, figmaType: FigmaVariable['figmaType']): string[] {
  if (figmaType === 'COLOR') return ['FRAME_FILL', 'SHAPE_FILL', 'STROKE_COLOR', 'TEXT_FILL'];
  if (figmaType === 'STRING') return ['FONT_FAMILY'];
  return BY_NAME.find(([re]) => re.test(t.name))?.[1] ?? ['WIDTH_HEIGHT', 'GAP'];
}

/** A px or rem length as a Figma number (1rem = 16px), or a reason it cannot be one. */
function toPx(v: string): number | string {
  const m = /^(-?\d*\.?\d+)(px|rem)$/.exec(v.trim());
  if (!m) return `${v} is not a px or rem length, which Figma needs`;
  return Number(m[1]) * (m[2] === 'rem' ? 16 : 1);
}

export function toProjectVariables(tokens: ManifestToken[]): { variables: FigmaVariable[]; skipped: SkippedToken[] } {
  const variables: FigmaVariable[] = [];
  const skipped: SkippedToken[] = [];
  for (const t of tokens) {
    let figmaType: FigmaVariable['figmaType'];
    let value: string | number;
    if (t.type === 'color') {
      const hex = String(t.value).toLowerCase();
      if (!/^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(hex)) {
        skipped.push({ name: t.name, reason: `${hex} is not a hex colour` });
        continue;
      }
      figmaType = 'COLOR';
      value = hex;
    } else if (t.type === 'dimension' || t.type === 'number') {
      const n = t.type === 'number' ? Number(t.value) : toPx(String(t.value));
      if (typeof n === 'string' || !Number.isFinite(n)) {
        skipped.push({ name: t.name, reason: typeof n === 'string' ? n : `${String(t.value)} is not a number` });
        continue;
      }
      figmaType = 'FLOAT';
      value = n;
    } else if (t.type === 'fontFamily') {
      const first = Array.isArray(t.value) ? String(t.value[0]) : String(t.value);
      figmaType = 'STRING';
      value = first;
    } else {
      skipped.push({ name: t.name, reason: `Figma variables have no ${t.type} type` });
      continue;
    }
    const notes = [
      t.description,
      t.fluid ? `Fluid in code: ${t.fluid.css}. Figma holds the minimum.` : undefined,
      t.responsive?.length
        ? `In code: ${t.responsive.map((r) => `${r.value} from ${r.minWidth}px`).join(', ')}.`
        : undefined,
      t.type === 'fontFamily' && Array.isArray(t.value) && t.value.length > 1
        ? `Fallbacks in code: ${t.value.slice(1).join(', ')}.`
        : undefined,
      t.provenance.decision
        ? `Design decision (${t.provenance.decision.decidedBy}, ${t.provenance.decision.date}): ${t.provenance.decision.reason} Source had ${t.provenance.sourceValue}.`
        : undefined,
      `Source: ${t.provenance.source}`,
    ].filter(Boolean);
    variables.push({
      name: t.name,
      figmaName: t.name.replace(/\./g, '/'),
      figmaType,
      value,
      scopes: scopesFor(t, figmaType),
      cssVar: t.cssVar,
      description: notes.join(' '),
    });
  }
  return { variables, skipped };
}

export function buildVariablesPayload(tokens: ManifestToken[], collectionName: string): VariablesPayload {
  return { kind: 'dsa-figma-variables', version: 1, collectionName, ...toProjectVariables(tokens) };
}

const VARIABLES_SOURCE = new URL('./plugin/variables.js', import.meta.url);

/** The Figma code that applies a payload. `PAYLOAD` must be defined before it runs. */
export function variablesScriptBody(): string {
  return readFileSync(VARIABLES_SOURCE, 'utf8').replace(/^\/\* global[^\n]*\n/, '');
}

/** The full script to pass as `code` to the Figma MCP `use_figma` tool. */
export function renderVariablesScript(payload: VariablesPayload): string {
  return `const PAYLOAD = ${JSON.stringify(payload)};\n${variablesScriptBody()}`;
}

/** What the Figma code returns: every variable in the collection, as Figma now holds it. */
export const VariablesReadback = z.object({
  kind: z.literal('dsa-figma-variables-readback'),
  fileName: z.string(),
  collection: z.object({ id: z.string(), name: z.string(), modes: z.number().int() }),
  variables: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      type: z.string(),
      value: z.union([z.string(), z.number(), z.null()]),
      scopes: z.array(z.string()),
      web: z.string().nullable(),
    }),
  ),
  created: z.number().int(),
  updated: z.number().int(),
});
export type VariablesReadback = z.infer<typeof VariablesReadback>;

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/** Compares Figma's read-back with the payload. An empty list means Figma matches the tokens. */
export function checkVariablesReadback(payload: VariablesPayload, rb: VariablesReadback): string[] {
  const problems: string[] = [];
  if (rb.collection.name !== payload.collectionName)
    problems.push(`Collection is "${rb.collection.name}", expected "${payload.collectionName}"`);
  const byName = new Map(rb.variables.map((v) => [v.name, v]));
  for (const want of payload.variables) {
    const got = byName.get(want.figmaName);
    if (!got) {
      problems.push(`${want.figmaName} is missing in Figma`);
      continue;
    }
    if (got.type !== want.figmaType) problems.push(`${want.figmaName} is ${got.type}, expected ${want.figmaType}`);
    const same =
      typeof want.value === 'number'
        ? typeof got.value === 'number' && near(got.value, want.value)
        : String(got.value).toLowerCase() === String(want.value).toLowerCase();
    if (!same)
      problems.push(`${want.figmaName} is ${JSON.stringify(got.value)}, expected ${JSON.stringify(want.value)}`);
    if ([...got.scopes].sort().join() !== [...want.scopes].sort().join())
      problems.push(
        `${want.figmaName} scopes are ${got.scopes.join(', ') || 'none'}, expected ${want.scopes.join(', ')}`,
      );
    if (got.web !== `var(${want.cssVar})`)
      problems.push(`${want.figmaName} code syntax is ${got.web ?? 'missing'}, expected var(${want.cssVar})`);
  }
  return problems;
}
