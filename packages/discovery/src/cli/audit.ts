/**
 * Usage: npm run audit -- <source-id>
 * Reads .cache/sources/<id> (run source:fetch first), checks it is at the pinned commit,
 * and writes audits/<id>/{inventory.json, tokens-candidates.tokens.json, drift-report.md, components.md}.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadSourceConfig, sourceCacheDir } from '../source-config.ts';
import { runAudit } from '../audit.ts';
import { renderComponentsReport, renderDriftReport, toDtcgCandidates } from '../report.ts';

const id = process.argv[2];
if (!id) {
  console.error('Usage: npm run audit -- <source-id>');
  process.exit(1);
}
const root = process.cwd();
const cfg = loadSourceConfig(root, id);
const dir = sourceCacheDir(root, id);
if (!existsSync(dir)) {
  console.error(`No checkout at ${dir}. Run: npm run source:fetch -- ${id}`);
  process.exit(1);
}
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir }).toString().trim();
if (head !== cfg.pinnedCommit) {
  console.error(`Checkout is at ${head} but source.json pins ${cfg.pinnedCommit}. Run source:fetch again.`);
  process.exit(1);
}

const inv = runAudit(dir, { id: cfg.id, repo: cfg.repo, commit: cfg.pinnedCommit });
const out = join(root, 'audits', id);
mkdirSync(out, { recursive: true });
const json = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
writeFileSync(join(out, 'inventory.json'), json(inv));
writeFileSync(join(out, 'tokens-candidates.tokens.json'), json(toDtcgCandidates(inv)));
writeFileSync(join(out, 'drift-report.md'), renderDriftReport(inv));
writeFileSync(join(out, 'components.md'), renderComponentsReport(inv));

const reusable = inv.components.filter((c) => c.reusable).length;
console.log(
  `Audit of ${id} at ${head.slice(0, 7)}: ${inv.tokens.length} tokens, ${inv.hardCoded.length} distinct hard-coded values, ` +
    `${inv.components.length} component blocks (${reusable} reusable). Written to audits/${id}/`,
);
