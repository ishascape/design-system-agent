/**
 * Usage: npm run tokens -- <source-id>
 * 1. Promotes audits/<id>/inventory.json through registry/tokens/<id>.token-map.json
 *    into registry/tokens/<id>.tokens.json (canonical, DTCG).
 * 2. Builds packages/tokens/dist/{tokens.css, tokens.manifest.json} with Style Dictionary.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { AuditInventory } from '@dsa/registry';
import { TokenMap, promoteTokens } from '../promote.ts';
import { buildTokens } from '../build.ts';

const id = process.argv[2];
if (!id || !/^[a-z0-9-]+$/.test(id)) {
  console.error('Usage: npm run tokens -- <source-id>');
  process.exit(1);
}
const root = process.cwd();
const readJson = (p: string) => JSON.parse(readFileSync(join(root, p), 'utf8')) as unknown;
const inv = AuditInventory.parse(readJson(`audits/${id}/inventory.json`));
const mapResult = TokenMap.safeParse(readJson(`registry/tokens/${id}.token-map.json`));
if (!mapResult.success) {
  console.error(`Invalid token map:\n${z.prettifyError(mapResult.error)}`);
  process.exit(1);
}
const canonicalPath = join(root, 'registry', 'tokens', `${id}.tokens.json`);
writeFileSync(canonicalPath, JSON.stringify(promoteTokens(inv, mapResult.data), null, 2) + '\n');
const manifest = await buildTokens(canonicalPath, join(root, 'packages', 'tokens', 'dist'));
console.log(`Promoted ${manifest.length} tokens for ${id}; built tokens.css and tokens.manifest.json`);
