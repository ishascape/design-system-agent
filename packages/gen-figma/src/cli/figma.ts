/**
 * Usage:
 *   npm run figma -- script            Writes .cache/figma/sync-button.js (the code for use_figma)
 *   npm run figma -- check <result>    Checks a saved use_figma result JSON against the registry,
 *                                      and updates registry/figma-map.json with the returned ids.
 *
 * Why two steps: Figma writes go through the official Figma MCP, which Claude calls with the
 * user's own Figma login. No Figma token is stored in this repo.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ComponentSpec } from '@dsa/registry';
import {
  FigmaMap,
  buildPayload,
  checkReadback,
  renderSyncScript,
  type ManifestToken,
  type Readback,
} from '../generate.ts';

const root = process.cwd();
const readJson = (p: string) => JSON.parse(readFileSync(join(root, p), 'utf8')) as unknown;
const tokens = readJson('packages/tokens/dist/tokens.manifest.json') as ManifestToken[];
const spec = ComponentSpec.parse(readJson('registry/components/button.json'));
const map = FigmaMap.parse(readJson('registry/figma-map.json'));
const payload = buildPayload(tokens, spec, map);

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'script') {
  mkdirSync(join(root, '.cache/figma'), { recursive: true });
  const out = join(root, '.cache/figma/sync-button.js');
  writeFileSync(out, renderSyncScript(payload));
  console.log(
    `Wrote ${out} (${payload.variables.length} variables, ${payload.button.variants.length * payload.button.states.length} variants)`,
  );
} else if (cmd === 'check' && arg) {
  const result = JSON.parse(readFileSync(arg, 'utf8')) as {
    collectionId: string;
    variableIds: Record<string, string>;
    componentSetId: string;
    readback: Readback;
  };
  const problems = checkReadback(payload, result.readback);
  if (problems.length) {
    console.error(`Figma read-back does not match the registry:\n${problems.map((p) => `- ${p}`).join('\n')}`);
    process.exit(1);
  }
  const updated = {
    ...(readJson('registry/figma-map.json') as Record<string, unknown>),
    collection: { id: result.collectionId, name: map.collection.name },
    variables: Object.fromEntries(Object.entries(result.variableIds).sort(([a], [b]) => a.localeCompare(b))),
    components: {
      ...map.components,
      button: { componentSet: result.componentSetId, file: map.components.button?.file ?? 'gate0-test' },
    },
  };
  writeFileSync(join(root, 'registry/figma-map.json'), JSON.stringify(updated, null, 2) + '\n');
  console.log(
    `Figma read-back matches the registry: ${result.readback.variants.length} variants checked. figma-map.json updated.`,
  );
} else {
  console.error('Usage: npm run figma -- script | check <result.json>');
  process.exit(1);
}
