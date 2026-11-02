/**
 * Builds token outputs from the canonical DTCG file with Style Dictionary.
 *
 * - tokens.css: CSS custom properties, including responsive overrides, fluid clamp() values
 *   and reduced-motion overrides recorded in $extensions.
 * - tokens.manifest.json: one flat, typed list of every token. This is the single input for
 *   the Figma generator, the docs site and AI agents, so they can never disagree.
 */
import StyleDictionary from 'style-dictionary';
import type { TransformedToken } from 'style-dictionary/types';

export interface ManifestToken {
  name: string;
  cssVar: string;
  type: string;
  /** Static value. For fluid tokens this is the minimum (what Figma uses). */
  value: string | number | string[] | number[];
  css: string;
  description?: string;
  responsive?: { minWidth: number; value: string }[];
  fluid?: { min: string; max: string; css: string };
  reducedMotion?: string;
  provenance: {
    source: string;
    sourceVar: string;
    commit: string;
    confidence: string;
    /** Present when a design decision replaced the source value. */
    sourceValue?: string;
    decision?: { value: string; reason: string; decidedBy: string; date: string };
  };
}

const ext = <T>(t: TransformedToken, key: string): T | undefined =>
  (t.$extensions as Record<string, unknown> | undefined)?.[key] as T | undefined;

export function cssValue(t: TransformedToken): string {
  const fluid = ext<{ css: string }>(t, 'dev.dsa.fluid');
  if (fluid) return fluid.css;
  const v = t.$value as unknown;
  if (t.$type === 'fontFamily' && Array.isArray(v))
    return v.map((f) => (/\s/.test(String(f)) ? `'${f}'` : String(f))).join(', ');
  if (t.$type === 'cubicBezier' && Array.isArray(v)) return `cubic-bezier(${v.join(', ')})`;
  return String(v);
}

export function toManifest(tokens: TransformedToken[]): ManifestToken[] {
  return tokens.map((t) => {
    const responsive = ext<{ minWidth: number; value: string }[]>(t, 'dev.dsa.responsive');
    const fluid = ext<ManifestToken['fluid']>(t, 'dev.dsa.fluid');
    const reduced = ext<{ value: string }>(t, 'dev.dsa.reducedMotion');
    return {
      name: t.path.join('.'),
      cssVar: `--${t.name}`,
      type: String(t.$type),
      value: t.$value as ManifestToken['value'],
      css: cssValue(t),
      ...(t.$description ? { description: t.$description } : {}),
      ...(responsive ? { responsive: responsive.map(({ minWidth, value }) => ({ minWidth, value })) } : {}),
      ...(fluid ? { fluid } : {}),
      ...(reduced ? { reducedMotion: reduced.value } : {}),
      provenance: ext<ManifestToken['provenance']>(t, 'dev.dsa.provenance')!,
    };
  });
}

export function renderCss(tokens: ManifestToken[], header: string): string {
  const lines = [`/* ${header} */`, ':root {', ...tokens.map((t) => `  ${t.cssVar}: ${t.css};`), '}'];
  const widths = [...new Set(tokens.flatMap((t) => t.responsive?.map((r) => r.minWidth) ?? []))].sort((a, b) => a - b);
  for (const w of widths) {
    lines.push('', `@media (min-width: ${w}px) {`, '  :root {');
    for (const t of tokens) {
      const r = t.responsive?.find((x) => x.minWidth === w);
      if (r) lines.push(`    ${t.cssVar}: ${r.value};`);
    }
    lines.push('  }', '}');
  }
  const reduced = tokens.filter((t) => t.reducedMotion !== undefined);
  if (reduced.length) {
    lines.push('', '@media (prefers-reduced-motion: reduce) {', '  :root {');
    for (const t of reduced) lines.push(`    ${t.cssVar}: ${t.reducedMotion};`);
    lines.push('  }', '}');
  }
  return lines.join('\n') + '\n';
}

export async function buildTokens(tokensFile: string, outDir: string): Promise<ManifestToken[]> {
  let manifest: ManifestToken[] = [];
  StyleDictionary.registerFormat({
    name: 'dsa/manifest',
    format: ({ dictionary }) => {
      manifest = toManifest(dictionary.allTokens);
      return JSON.stringify(manifest, null, 2) + '\n';
    },
  });
  StyleDictionary.registerFormat({
    name: 'dsa/css',
    format: ({ dictionary }) =>
      renderCss(toManifest(dictionary.allTokens), 'Generated from the canonical registry. Do not edit by hand.'),
  });
  const sd = new StyleDictionary({
    source: [tokensFile],
    usesDtcg: true,
    log: { verbosity: 'silent', warnings: 'error' },
    platforms: {
      web: {
        transforms: ['name/kebab'],
        buildPath: outDir.endsWith('/') ? outDir : `${outDir}/`,
        files: [
          { destination: 'tokens.css', format: 'dsa/css' },
          { destination: 'tokens.manifest.json', format: 'dsa/manifest' },
        ],
      },
    },
  });
  await sd.buildAllPlatforms();
  return manifest;
}
