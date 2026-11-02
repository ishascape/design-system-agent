/**
 * Runs discovery over a checked-out source repository and returns a validated audit inventory.
 * Read-only: it lists and reads files, nothing else.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { AUDIT_SCHEMA_VERSION, AuditInventory } from '@dsa/registry';
import { countVarUsage, parseTokens, type CssFile } from './tokens.ts';
import { scanHardCoded } from './drift.ts';
import { findComponentCandidates } from './components.ts';

const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-ssr', 'build', '.git', 'coverage', 'public']);
const MAX_FILE_BYTES = 1_000_000;

/** `x.min.css` is a minified copy of another file; reading both would double-count every value. */
const isMinified = (name: string) => /\.min\.[a-z]+$/.test(name);

export function listFiles(root: string, extensions: string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(name) && !name.startsWith('.')) walk(full);
      } else if (extensions.some((e) => name.endsWith(e)) && !isMinified(name) && st.size <= MAX_FILE_BYTES) {
        out.push(relative(root, full).split(sep).join('/'));
      }
    }
  };
  walk(root);
  return out;
}

export interface AuditSource {
  id: string;
  repo: string;
  commit: string;
}

export interface AuditOptions {
  /** Page markup to read class names from (websites), relative to the source folder. */
  markup?: string[];
}

export function runAudit(repoDir: string, source: AuditSource, opts: AuditOptions = {}): AuditInventory {
  const read = (p: string): CssFile => ({ path: p, content: readFileSync(join(repoDir, p), 'utf8') });
  const cssFiles = listFiles(repoDir, ['.css']).map(read);
  const componentFiles = [...listFiles(repoDir, ['.tsx', '.jsx']), ...(opts.markup ?? [])].map(read);

  const varUsage = countVarUsage([...cssFiles, ...componentFiles].map((f) => f.content));
  const tokens = parseTokens(cssFiles).map((t) => ({ ...t, usageCount: varUsage.get(t.id) ?? 0 }));

  const inventory = {
    schemaVersion: AUDIT_SCHEMA_VERSION,
    source,
    scanned: { cssFiles: cssFiles.length, componentFiles: componentFiles.length },
    tokens,
    hardCoded: scanHardCoded(cssFiles, tokens),
    components: findComponentCandidates(componentFiles, cssFiles),
  };
  // Throws with a readable path to the bad field if discovery produced something invalid.
  return AuditInventory.parse(inventory);
}
