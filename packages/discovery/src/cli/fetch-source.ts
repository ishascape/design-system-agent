/**
 * Usage: npm run source:fetch -- <source-id>
 * Clones the source repo into .cache/sources/<id> and checks out the pinned commit.
 * Never pushes, never writes to the source repo. Re-running is safe.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadSourceConfig, sourceCacheDir } from '../source-config.ts';

const id = process.argv[2];
if (!id) {
  console.error('Usage: npm run source:fetch -- <source-id>');
  process.exit(1);
}
const root = process.cwd();
const cfg = loadSourceConfig(root, id);
const dir = sourceCacheDir(root, id);
const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: dir, stdio: ['ignore', 'pipe', 'inherit'] })
    .toString()
    .trim();

if (!existsSync(dir)) {
  mkdirSync(dirname(dir), { recursive: true });
  execFileSync('git', ['init', '-q', dir]);
  git('remote', 'add', 'origin', cfg.repo);
}
// Hooks disabled: fetching untrusted repos must never run their code.
git('-c', 'core.hooksPath=/dev/null', 'fetch', '-q', '--depth', '1', 'origin', cfg.pinnedCommit);
git('-c', 'core.hooksPath=/dev/null', 'checkout', '-q', '--detach', cfg.pinnedCommit);
const head = git('rev-parse', 'HEAD');
if (head !== cfg.pinnedCommit) throw new Error(`Checked out ${head}, expected ${cfg.pinnedCommit}`);
console.log(`Fetched ${cfg.id} at ${head} into ${dir}`);
