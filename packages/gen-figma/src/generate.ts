/**
 * The Figma export contract: turns registry data into (1) a payload and (2) a complete Plugin API
 * script for the official Figma MCP `use_figma` tool, and checks the script's read-back against
 * what the registry says Figma should contain.
 */
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { ComponentSpec } from '@dsa/registry';

export interface ManifestToken {
  name: string;
  cssVar: string;
  type: string;
  value: unknown;
  css: string;
  description?: string;
  responsive?: { minWidth: number; value: string }[];
  fluid?: { min: string; max: string; css: string };
  provenance: { source: string; sourceValue?: string; decision?: { reason: string; decidedBy: string; date: string } };
}

export const FigmaMap = z.object({
  files: z.record(z.string(), z.object({ fileKey: z.string(), url: z.url(), purpose: z.string() })),
  collection: z.object({ id: z.string().optional(), name: z.string() }),
  variables: z.record(z.string(), z.string()),
  components: z.record(z.string(), z.object({ node: z.string(), file: z.string() })),
});
export type FigmaMap = z.infer<typeof FigmaMap>;

type FigmaType = 'COLOR' | 'FLOAT' | 'STRING';

export interface FigmaVariable {
  name: string;
  figmaName: string;
  figmaType: FigmaType;
  value: string | number;
  scopes: string[];
  cssVar: string;
  description: string;
}

const SCOPES: [RegExp, string[]][] = [
  [/^color\./, ['FRAME_FILL', 'SHAPE_FILL', 'STROKE_COLOR', 'TEXT_FILL']],
  [/^space\./, ['GAP']],
  [/^radius\./, ['CORNER_RADIUS']],
  [/^line\./, ['STROKE_FLOAT']],
  [/^size\./, ['WIDTH_HEIGHT']],
  [/^font\.size\./, ['FONT_SIZE']],
  [/^font\.family\./, ['FONT_FAMILY']],
  [/^layout\./, ['WIDTH_HEIGHT', 'GAP']],
];

const px = (v: string): number => {
  const m = /^(-?\d*\.?\d+)px$/.exec(v);
  if (!m) throw new Error(`Expected a px value, got ${v}`);
  return Number(m[1]);
};

/** Tokens Figma variables can hold. Motion tokens have no Figma equivalent and are skipped. */
export function toFigmaVariables(tokens: ManifestToken[]): FigmaVariable[] {
  const out: FigmaVariable[] = [];
  for (const t of tokens) {
    const scopes = SCOPES.find(([re]) => re.test(t.name))?.[1];
    if (!scopes) continue;
    let figmaType: FigmaType;
    let value: string | number;
    if (t.type === 'color') {
      figmaType = 'COLOR';
      value = String(t.value);
      if (!/^#[0-9a-f]{6}$/.test(value)) throw new Error(`${t.name}: Figma sync needs #rrggbb, got ${value}`);
    } else if (t.type === 'dimension') {
      figmaType = 'FLOAT';
      value = px(String(t.value));
    } else if (t.type === 'fontFamily') {
      figmaType = 'STRING';
      value = (t.value as string[])[0]!;
    } else continue;
    const notes = [
      t.description,
      t.fluid ? `Fluid in code: ${t.fluid.css}. Figma holds the minimum.` : undefined,
      t.responsive?.length
        ? `In code: ${t.responsive.map((r) => `${r.value} from ${r.minWidth}px`).join(', ')}.`
        : undefined,
      t.provenance.decision
        ? `Design decision (${t.provenance.decision.decidedBy}, ${t.provenance.decision.date}): ${t.provenance.decision.reason} Source had ${t.provenance.sourceValue}.`
        : undefined,
      `Source: ${t.provenance.source}`,
    ].filter(Boolean);
    out.push({
      name: t.name,
      figmaName: t.name.replace(/\./g, '/'),
      figmaType,
      value,
      scopes,
      cssVar: t.cssVar,
      description: notes.join(' '),
    });
  }
  return out;
}

const STATE_LABEL: Record<string, string> = {
  default: 'Default',
  hover: 'Hover',
  'focus-visible': 'Focus',
  disabled: 'Disabled',
};
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

export interface Payload {
  collectionName: string;
  ids: { collection?: string; variables: Record<string, string>; componentSet?: string };
  variables: FigmaVariable[];
  font: { family: string; style: string };
  constants: {
    lineHeightPercent: number;
    disabledOpacity: number;
    cornerMarkSize: number;
    cornerMarkOffset: number;
    cornerMarkOpacity: number;
    focusRingWidth: number;
    focusRingOffset: number;
    radius: number;
  };
  button: { name: string; description: string; defaultLabel: string; variants: string[]; states: string[] };
}

export function buildPayload(tokens: ManifestToken[], spec: ComponentSpec, map: FigmaMap): Payload {
  const variables = toFigmaVariables(tokens);
  const sans = tokens.find((t) => t.name === 'font.family.sans');
  const radius = tokens.find((t) => t.name === 'radius.default');
  if (!sans || !radius) throw new Error('Figma sync needs font.family.sans and radius.default tokens');
  const states = spec.states.map((s) => STATE_LABEL[s.name]).filter((s): s is string => !!s);
  return {
    collectionName: map.collection.name,
    ids: {
      ...(map.collection.id ? { collection: map.collection.id } : {}),
      variables: map.variables,
      ...(map.components[spec.id] ? { componentSet: map.components[spec.id]!.node } : {}),
    },
    variables,
    font: { family: (sans.value as string[])[0]!, style: 'Regular' },
    constants: {
      lineHeightPercent: 165,
      disabledOpacity: 0.45,
      cornerMarkSize: 10,
      cornerMarkOffset: 6,
      cornerMarkOpacity: 0.45,
      focusRingWidth: 2,
      focusRingOffset: 3,
      radius: px(String(radius.value)),
    },
    button: {
      name: spec.name,
      description: `${spec.summary} Status: ${spec.status}. Generated from registry/components/${spec.id}.json (v${spec.version}); edit the registry, not this component. Code: ${spec.code.file}.`,
      defaultLabel: 'Explore my work',
      variants: spec.variants.map((v) => cap(v.name)),
      states,
    },
  };
}

const PLUGIN_SOURCE = new URL('./plugin/sync.js', import.meta.url);

/** The full script to pass as `code` to use_figma. */
export function renderSyncScript(payload: Payload): string {
  const body = readFileSync(PLUGIN_SOURCE, 'utf8').replace(/^\/\* global[^\n]*\n/, '');
  return `const PAYLOAD = ${JSON.stringify(payload)};\n${body}`;
}

export interface VariantReadback {
  name: string;
  opacity: number;
  fill: string | null;
  stroke: string | null;
  strokeWeight: string | null;
  radius: string | null;
  paddingX: string | null;
  gap: string | null;
  minHeight: string | null;
  label: { fill: string | null; fontSize: string | null; font: string; boundToProperty: boolean } | null;
  cornerMarksVisible: boolean;
  focusRingVisible: boolean;
  /** Bound paints whose fallback colour differs from the variable value. Must be empty. */
  stalePaints?: string[];
}
export interface Readback {
  componentSet: { type: string; name: string };
  properties: Record<string, { type: string; options: string[] | null }>;
  variants: VariantReadback[];
}

/** Compares a Figma read-back with what the payload says must be there. Empty list means it matches. */
export function checkReadback(payload: Payload, rb: Readback): string[] {
  const p: string[] = [];
  const b = payload.button;
  if (rb.componentSet.type !== 'COMPONENT_SET') p.push(`Expected a COMPONENT_SET, got ${rb.componentSet.type}`);
  const eq = (a: unknown, e: unknown, what: string) => {
    if (JSON.stringify(a) !== JSON.stringify(e))
      p.push(`${what}: expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`);
  };
  eq(rb.properties.Variant, { type: 'VARIANT', options: b.variants }, 'Variant property');
  eq(rb.properties.State, { type: 'VARIANT', options: b.states }, 'State property');
  eq(rb.properties.Label?.type, 'TEXT', 'Label property type');
  const expectedNames = b.variants.flatMap((v) => b.states.map((s) => `Variant=${v}, State=${s}`));
  eq(rb.variants.map((v) => v.name).sort(), [...expectedNames].sort(), 'Variant list');

  for (const v of rb.variants) {
    const m = /^Variant=(\w+), State=(\w+)$/.exec(v.name);
    if (!m) continue;
    const [, variant, state] = m as unknown as [string, string, string];
    const filled = variant === 'Primary';
    const hover = state === 'Hover';
    const w = (field: string, actual: unknown, expected: unknown) => eq(actual, expected, `${v.name} ${field}`);
    w('fill', v.fill, hover ? 'color/marker' : filled ? 'color/ink' : 'none');
    w('stroke', v.stroke, hover ? 'color/marker' : 'color/ink');
    w('strokeWeight', v.strokeWeight, 'line/building');
    w('radius', v.radius, 'radius/default');
    w('paddingX', v.paddingX, 'space/4');
    w('gap', v.gap, 'space/2');
    w('minHeight', v.minHeight, 'size/tap');
    w('label.fill', v.label?.fill, hover || filled ? 'color/paper' : 'color/ink');
    w('label.fontSize', v.label?.fontSize, 'font/size/body');
    w('label.font', v.label?.font, `${payload.font.family} ${payload.font.style}`);
    w('label.boundToProperty', v.label?.boundToProperty, true);
    w('opacity', Math.round(v.opacity * 100) / 100, state === 'Disabled' ? payload.constants.disabledOpacity : 1);
    w('cornerMarksVisible', v.cornerMarksVisible, state === 'Hover' || state === 'Focus');
    w('focusRingVisible', v.focusRingVisible, state === 'Focus');
    w('stalePaints', v.stalePaints ?? 'missing from read-back', []);
  }
  return p;
}
