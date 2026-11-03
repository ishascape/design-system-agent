/**
 * Source integration. Sources are untrusted: they are fetched and parsed, never executed.
 * - GitHub (or any https git repo): shallow clone at a resolved commit with git hooks disabled,
 *   no credential prompts, and the file:// protocol refused.
 * - Website: the page HTML and its same-origin stylesheets are downloaded (no scripts are run),
 *   size-capped, and stored as a snapshot whose content hash stands in for a commit.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { SourceKind } from './db.ts';

const exec = promisify(execFile);

/** Set only by tests, to clone local fixture repos. */
const allowFile = () => process.env.STUDIO_ALLOW_FILE_SOURCES === '1';

/** Tests serve fixture sites from this computer; real runs never render local addresses. */
export const allowLocalSites = allowFile;

export function validateSourceUrl(kind: SourceKind, url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return 'Enter a full address, starting with https://';
  }
  if (kind === 'github') {
    if (u.protocol === 'file:' && allowFile()) return null;
    if (u.protocol !== 'https:') return 'Repositories must use an https:// address';
    if (u.username || u.password) return 'Do not put credentials in the address; your own git login is used';
    return null;
  }
  if (kind === 'website') {
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'Websites must start with https://';
    return null;
  }
  if (kind === 'figma') {
    if (u.protocol !== 'https:' || !/(^|\.)figma\.com$/.test(u.hostname)) return 'Use a figma.com file link';
    return null;
  }
  return null;
}

export interface FetchedSource {
  dir: string;
  commit: string;
  ref: string;
  files: number;
  /** Websites only: stylesheets and style blocks found in the downloaded HTML. */
  styles?: number;
}

const gitEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo' };
const safe = () => ['-c', 'core.hooksPath=/dev/null', '-c', `protocol.file.allow=${allowFile() ? 'always' : 'never'}`];

async function git(cwd: string, args: string[], signal: AbortSignal) {
  const { stdout } = await exec('git', [...safe(), ...args], { cwd, env: gitEnv, signal, maxBuffer: 16 * 1024 * 1024 });
  return stdout.trim();
}

export async function fetchRepo(
  url: string,
  ref: string,
  dir: string,
  signal: AbortSignal,
  log: (m: string) => void,
): Promise<FetchedSource> {
  log(`Resolving ${ref} on ${url}`);
  const remote = await git(process.cwd(), ['ls-remote', url, ref], signal);
  let commit = remote.split(/\s+/)[0] ?? '';
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    if (/^[0-9a-f]{40}$/.test(ref)) commit = ref;
    else throw new Error(`Could not find "${ref}" in ${url}. Check the address and that your git login can read it.`);
  }
  log(`Pinned to commit ${commit.slice(0, 7)}`);
  if (!existsSync(join(dir, '.git'))) {
    mkdirSync(dir, { recursive: true });
    await git(dir, ['init', '-q'], signal);
    await git(dir, ['remote', 'add', 'origin', url], signal);
  } else {
    await git(dir, ['remote', 'set-url', 'origin', url], signal);
  }
  await git(dir, ['fetch', '-q', '--depth', '1', 'origin', commit], signal);
  await git(dir, ['checkout', '-q', '--detach', '--force', commit], signal);
  const head = await git(dir, ['rev-parse', 'HEAD'], signal);
  if (head !== commit) throw new Error(`Checked out ${head}, expected ${commit}`);
  const files = (await git(dir, ['ls-files'], signal)).split('\n').filter(Boolean).length;
  log(`Fetched ${files} files (read-only copy; no code from the repository was run)`);
  return { dir, commit, ref, files };
}

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_STYLESHEETS = 25;

async function download(url: string, signal: AbortSignal): Promise<{ text: string; type: string }> {
  const res = await fetch(url, { signal, redirect: 'follow', headers: { 'user-agent': 'DesignSystemStudio/0.1' } });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > MAX_BYTES) throw new Error(`${url} is larger than 5 MB`);
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new Error(`${url} is larger than 5 MB`);
  return { text, type: res.headers.get('content-type') ?? '' };
}

export async function fetchWebsite(
  url: string,
  dir: string,
  signal: AbortSignal,
  log: (m: string) => void,
): Promise<FetchedSource> {
  log(`Downloading ${url} (HTML and stylesheets; nothing is run by this download)`);
  const page = await download(url, signal);
  if (!page.type.includes('html')) throw new Error(`${url} is not an HTML page (${page.type || 'unknown type'})`);
  const base = new URL(url);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'styles'), { recursive: true });
  writeFileSync(join(dir, 'page.html'), page.text);
  const hash = createHash('sha1').update(page.text);

  const hrefs = [...page.text.matchAll(/<link\b[^>]*>/gi)]
    .map((m) => m[0])
    .filter((tag) => /rel\s*=\s*["']?stylesheet/i.test(tag))
    .map((tag) => /href\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1])
    .filter((h): h is string => !!h)
    .map((h) => new URL(h, base))
    .filter((u) => u.origin === base.origin);
  const inline = [...page.text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1] ?? '');

  let n = 0;
  for (const u of hrefs.slice(0, MAX_STYLESHEETS)) {
    const css = await download(u.href, signal);
    const name = `${String(++n).padStart(2, '0')}-${
      u.pathname
        .split('/')
        .pop()
        ?.replace(/[^A-Za-z0-9._-]/g, '_') || 'style'
    }`;
    writeFileSync(join(dir, 'styles', name.endsWith('.css') ? name : `${name}.css`), css.text);
    hash.update(css.text);
    log(`Stylesheet ${u.pathname}`);
  }
  inline.forEach((css, i) => {
    writeFileSync(join(dir, 'styles', `inline-${i + 1}.css`), css);
    hash.update(css);
  });
  if (hrefs.length > MAX_STYLESHEETS) log(`Only the first ${MAX_STYLESHEETS} stylesheets were downloaded`);
  const commit = hash.digest('hex');
  log(`Snapshot ${commit.slice(0, 7)}: ${n} stylesheets, ${inline.length} inline style blocks`);
  return { dir, commit, ref: 'snapshot', files: n + inline.length + 1, styles: n + inline.length };
}
