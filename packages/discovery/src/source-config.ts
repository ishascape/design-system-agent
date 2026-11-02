/** Loads and validates `sources/<id>/source.json`. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

export const SourceConfig = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  liveUrl: z.url().optional(),
  repo: z.url(),
  pinnedCommit: z.string().regex(/^[0-9a-f]{40}$/, 'pinnedCommit must be a full 40-character commit SHA'),
  pinnedAt: z.string().optional(),
  access: z.literal('read-only'),
  status: z.string().optional(),
});
export type SourceConfig = z.infer<typeof SourceConfig>;

export function loadSourceConfig(rootDir: string, id: string): SourceConfig {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`Invalid source id "${id}". Use lowercase letters, digits and dashes.`);
  const path = join(rootDir, 'sources', id, 'source.json');
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`Could not read ${path}: ${(err as Error).message}`, { cause: err });
  }
  const parsed = SourceConfig.safeParse(raw);
  if (!parsed.success) throw new Error(`Invalid ${path}:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

export const sourceCacheDir = (rootDir: string, id: string) => join(rootDir, '.cache', 'sources', id);
