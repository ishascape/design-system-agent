/**
 * Usage: npm run catalog            (writes docs/agents/* and llms.txt)
 *        npm run catalog -- --check (fails if layers disagree or generated files are stale)
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { ComponentSpec } from '@dsa/registry';
import { BUTTON_VARIANTS } from '../../../ui/src/button/variants.ts';
import {
  buildCatalog,
  checkComponent,
  renderComponentMarkdown,
  renderLlmsTxt,
  type ManifestToken,
} from '../catalog.ts';

const VARIANTS_IN_CODE: Record<string, readonly string[]> = { button: BUTTON_VARIANTS };

const check = process.argv.includes('--check');
const root = process.cwd();
const tokens = JSON.parse(
  readFileSync(join(root, 'packages/tokens/dist/tokens.manifest.json'), 'utf8'),
) as ManifestToken[];
const specDir = join(root, 'registry/components');
const specs = readdirSync(specDir)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => {
    const r = ComponentSpec.safeParse(JSON.parse(readFileSync(join(specDir, f), 'utf8')));
    if (!r.success) throw new Error(`Invalid spec ${f}:\n${z.prettifyError(r.error)}`);
    return r.data;
  });

const problems = specs.flatMap((s) => {
  const variants = VARIANTS_IN_CODE[s.id];
  return variants ? checkComponent(root, s, tokens, variants) : [`${s.id}: no code variants registered in catalog CLI`];
});
if (problems.length) {
  console.error(`Layers disagree:\n${problems.map((p) => `- ${p}`).join('\n')}`);
  process.exit(1);
}

const cat = buildCatalog(root, 'ashnidave.com', tokens, specs);
const files: Record<string, string> = {
  'docs/agents/catalog.json': JSON.stringify(cat, null, 2) + '\n',
  'llms.txt': renderLlmsTxt(cat),
  ...Object.fromEntries(
    cat.components.map((c) => [`docs/agents/components/${c.spec.id}.md`, renderComponentMarkdown(c, tokens)]),
  ),
};

const stale: string[] = [];
for (const [rel, content] of Object.entries(files)) {
  const abs = join(root, rel);
  if (check) {
    if (!existsSync(abs) || readFileSync(abs, 'utf8') !== content) stale.push(rel);
  } else {
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  }
}
if (stale.length) {
  console.error(`Generated files are out of date: ${stale.join(', ')}. Run: npm run catalog`);
  process.exit(1);
}
console.log(
  check ? `Catalog check passed for ${specs.length} component(s).` : `Wrote catalog for ${specs.length} component(s).`,
);
