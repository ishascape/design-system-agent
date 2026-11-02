/**
 * End-to-end tests of the Studio server: real SQLite, real workflow engine, real git clone of a
 * fixture repo and the real pipeline packages. Only the HTTP transport is in-process.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Store, type Step } from '../server/db.ts';
import { createApp } from '../server/app.ts';
import { Engine } from '../server/workflow/engine.ts';
import { designSystemWorkflow, proposeName } from '../server/workflow/design-system.ts';
import type { WorkflowDefinition } from '../server/workflow/types.ts';

process.env.STUDIO_ALLOW_FILE_SOURCES = '1';

const home = mkdtempSync(join(tmpdir(), 'studio-test-'));
const fixtureRepo = join(home, 'fixture-repo');

/** A workflow whose second step waits until it is cancelled, to test cancellation. */
const slowWorkflow: WorkflowDefinition = {
  id: 'slow',
  title: 'Slow',
  steps: [
    {
      key: 'one',
      title: 'One',
      description: '',
      action: '',
      run: () => ({ summary: { headline: 'ok', facts: [], warnings: [] }, output: 1 }),
    },
    {
      key: 'wait',
      title: 'Wait',
      description: '',
      action: '',
      params: z.object({ ms: z.number().default(10_000) }),
      run: (ctx) =>
        new Promise((resolve, reject) => {
          const t = setTimeout(
            () => resolve({ summary: { headline: 'waited', facts: [], warnings: [] }, output: 2 }),
            Number(ctx.params.ms),
          );
          ctx.signal.addEventListener('abort', () => {
            clearTimeout(t);
            reject(new Error('aborted'));
          });
        }),
    },
  ],
};

const store = new Store(join(home, 'studio.db'));
const workflows = { [designSystemWorkflow.id]: designSystemWorkflow, slow: slowWorkflow };
const projectDir = (id: string) => join(home, 'projects', id);
const engine = new Engine(store, workflows, projectDir);
const app = createApp({ store, engine, workflows, projectDir, allowedHosts: ['localhost'] });

const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const res = await app.request(path, {
    method,
    headers: { host: 'localhost', 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* plain text */
  }
  return { status: res.status, data: data as Record<string, string> };
};
type RunView = { id: string; status: string; steps: Step[] };
const statuses = (r: RunView) => Object.fromEntries(r.steps.map((s) => [s.key, s.status]));

beforeAll(() => {
  cpSync(join(process.cwd(), 'tests/fixtures/mini-site'), fixtureRepo, { recursive: true });
  const g = (...a: string[]) => execFileSync('git', a, { cwd: fixtureRepo, stdio: 'ignore' });
  g('init', '-q');
  g('add', '-A');
  g('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'fixture');
});
afterAll(() => store.db.close());

describe('projects', () => {
  it('creates, lists and validates projects and sources', async () => {
    const bad = await call('POST', '/api/projects', {
      name: 'X',
      source: { kind: 'github', url: 'git@github.com:a/b.git' },
    });
    expect(bad.status).toBe(400);
    const empty = await call('POST', '/api/projects', { name: '' });
    expect(empty.status).toBe(400);
    const ok = await call('POST', '/api/projects', {
      name: 'Fixture',
      source: { kind: 'github', url: `file://${fixtureRepo}` },
    });
    expect(ok.status).toBe(201);
    expect(ok.data.id).toMatch(/^prj_[0-9a-f]{16}$/);
    const list = await call('GET', '/api/projects');
    expect((list.data as unknown as { name: string }[]).map((p) => p.name)).toContain('Fixture');
  });

  it('refuses other hosts and cross-site writes', async () => {
    expect((await call('GET', '/api/projects', undefined, { host: 'evil.example' })).status).toBe(403);
    expect((await call('POST', '/api/projects', { name: 'Y' }, { origin: 'https://evil.example' })).status).toBe(403);
  });

  it('deletes only when the name is typed exactly', async () => {
    const p = (await call('POST', '/api/projects', { name: 'Temp' })).data;
    expect((await call('DELETE', `/api/projects/${p.id}`, { confirm: 'temp' })).status).toBe(400);
    expect((await call('DELETE', `/api/projects/${p.id}`, { confirm: 'Temp' })).status).toBe(200);
    expect((await call('GET', `/api/projects/${p.id}`)).status).toBe(404);
  });
});

describe('design-system workflow on a real repo', () => {
  let pid = '';
  let run: RunView;

  it('runs import, discover, extract, components and audit, then pauses for approval', async () => {
    const p = (
      await call('POST', '/api/projects', { name: 'Mini', source: { kind: 'github', url: `file://${fixtureRepo}` } })
    ).data;
    pid = p.id as string;
    const sourceId = (p.sources as unknown as { id: string }[])[0]!.id;
    const started = await call('POST', `/api/projects/${pid}/runs`, { sourceId });
    expect(started.status).toBe(201);
    const second = await call('POST', `/api/projects/${pid}/runs`, { sourceId });
    expect(second.status).toBe(409);
    await engine.idle(started.data.id as string);
    run = (await call('GET', `/api/projects/${pid}/runs/${started.data.id}`)).data as unknown as RunView;
    expect(run.status).toBe('awaiting-approval');
    expect(statuses(run)).toMatchObject({
      'import-source': 'succeeded',
      discover: 'succeeded',
      'extract-tokens': 'succeeded',
      'identify-components': 'succeeded',
      audit: 'succeeded',
      review: 'awaiting-approval',
      'generate-code': 'pending',
    });
    const imp = run.steps[0]!;
    expect((imp.output as { commit: string }).commit).toMatch(/^[0-9a-f]{40}$/);
    const logs = (await call('GET', `/api/projects/${pid}/steps/${imp.id}/logs`)).data as unknown as {
      message: string;
    }[];
    expect(logs.some((l) => l.message.includes('no code from the repository was run'))).toBe(true);
  });

  it('stores versioned artifacts that can be read back as plain text', async () => {
    const arts = (await call('GET', `/api/projects/${pid}/artifacts?runId=${run.id}`)).data as unknown as {
      id: string;
      kind: string;
      version: number;
    }[];
    expect(arts.map((a) => a.kind).sort()).toEqual([
      'components-report',
      'drift-report',
      'inventory',
      'token-candidates',
    ]);
    const inv = arts.find((a) => a.kind === 'inventory')!;
    expect(inv.version).toBe(1);
    const res = await app.request(`/api/projects/${pid}/artifacts/${inv.id}/raw`, { headers: { host: 'localhost' } });
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(res.headers.get('content-security-policy')).toContain('sandbox');
    expect(JSON.parse(await res.text()).schemaVersion).toBe(1);
  });

  it('rejects, then re-runs the review step', async () => {
    const review = run.steps.find((s) => s.key === 'review')!;
    const rejected = (await call('POST', `/api/projects/${pid}/steps/${review.id}/reject`, { note: 'names need work' }))
      .data as unknown as RunView;
    expect(rejected.status).toBe('rejected');
    await engine.rerun(pid, review.id);
    run = (await call('GET', `/api/projects/${pid}/runs/${run.id}`)).data as unknown as RunView;
    expect(statuses(run).review).toBe('awaiting-approval');
    expect(run.steps.find((s) => s.key === 'review')!.attempt).toBe(2);
  });

  it('applies the approval with exclusions and renames, builds tokens and a Figma script, then blocks at docs', async () => {
    const review = run.steps.find((s) => s.key === 'review')!;
    const tokens = (review.output as { tokens: { cssVar: string }[] }).tokens;
    const dupe = await call('POST', `/api/projects/${pid}/steps/${review.id}/approve`, {
      decision: { rename: { [tokens[0]!.cssVar]: 'color.same', [tokens[1]!.cssVar]: 'color.same' } },
    });
    expect(dupe.status).toBe(400);
    const res = await call('POST', `/api/projects/${pid}/steps/${review.id}/approve`, {
      decision: { exclude: [tokens[0]!.cssVar] },
      note: 'looks right',
    });
    expect(res.status).toBe(200);
    await engine.idle(run.id);
    run = (await call('GET', `/api/projects/${pid}/runs/${run.id}`)).data as unknown as RunView;
    expect(statuses(run)).toMatchObject({
      review: 'succeeded',
      'generate-code': 'succeeded',
      'generate-figma': 'succeeded',
      'generate-docs': 'blocked',
    });
    expect(run.status).toBe('blocked');
    const figma = run.steps.find((s) => s.key === 'generate-figma')!;
    expect((figma.output as { variables: number }).variables).toBeGreaterThan(0);
    expect(figma.summary!.warnings[0]).toMatch(/^Not applied to Figma yet/);
    const arts = (await call('GET', `/api/projects/${pid}/artifacts`)).data as unknown as { kind: string }[];
    expect(arts.some((a) => a.kind === 'figma-sync')).toBe(true);
    const map = JSON.parse(readFileSync(join(projectDir(pid), 'registry/token-map.json'), 'utf8'));
    expect(Object.keys(map.tokens)).toHaveLength(tokens.length - 1);
    const f = (await call('GET', `/api/projects/${pid}/foundations`)).data;
    expect(f.status).toBe('built');
  });

  it('keeps projects isolated: ids from one project do not resolve in another', async () => {
    const other = (await call('POST', '/api/projects', { name: 'Other' })).data;
    const step = run.steps[0]!;
    expect((await call('GET', `/api/projects/${other.id}/runs/${run.id}`)).status).toBe(404);
    expect((await call('GET', `/api/projects/${other.id}/steps/${step.id}/logs`)).status).toBe(404);
    const art = ((await call('GET', `/api/projects/${pid}/artifacts`)).data as unknown as { id: string }[])[0]!;
    expect((await call('GET', `/api/projects/${other.id}/artifacts/${art.id}/raw`)).status).toBe(404);
    expect(existsSync(join(projectDir(other.id as string), 'registry'))).toBe(false);
  });
});

describe('failures, retries, cancel and restart', () => {
  it('records a failed import with its error, and retries it as a new attempt', async () => {
    const p = (
      await call('POST', '/api/projects', {
        name: 'Broken',
        source: { kind: 'github', url: `file://${home}/missing-repo` },
      })
    ).data;
    const sourceId = (p.sources as unknown as { id: string }[])[0]!.id;
    const r = (await call('POST', `/api/projects/${p.id}/runs`, { sourceId })).data;
    await engine.idle(r.id as string);
    let view = (await call('GET', `/api/projects/${p.id}/runs/${r.id}`)).data as unknown as RunView;
    expect(view.status).toBe('failed');
    expect(view.steps[0]!.error).toBeTruthy();
    await engine.rerun(p.id as string, view.steps[0]!.id);
    view = (await call('GET', `/api/projects/${p.id}/runs/${r.id}`)).data as unknown as RunView;
    expect(view.steps[0]!.attempt).toBe(2);
    expect(view.status).toBe('failed');
  });

  it('blocks honestly on sources it cannot import yet', async () => {
    const p = (
      await call('POST', '/api/projects', {
        name: 'Figma',
        source: { kind: 'figma', url: 'https://www.figma.com/design/abc/x' },
      })
    ).data;
    const sourceId = (p.sources as unknown as { id: string }[])[0]!.id;
    const r = (await call('POST', `/api/projects/${p.id}/runs`, { sourceId })).data;
    await engine.idle(r.id as string);
    const view = (await call('GET', `/api/projects/${p.id}/runs/${r.id}`)).data as unknown as RunView;
    expect(view.status).toBe('blocked');
    expect(view.steps[0]!.error).toMatch(/not available yet/);
  });

  it('cancels a running step through its abort signal', async () => {
    const p = store.createProject('Slow');
    const s = store.addSource(p.id, 'website', 'https://example.com', 'x');
    const r = engine.start(p.id, 'slow', s.id);
    await new Promise((res) => setTimeout(res, 50));
    expect(store.getRun(p.id, r.id)!.status).toBe('running');
    engine.cancel(p.id, r.id);
    await engine.idle(r.id);
    expect(store.getRun(p.id, r.id)!.status).toBe('cancelled');
    expect(store.listSteps(p.id, r.id)[1]!.status).toBe('cancelled');
  });

  it('re-runs a step with new parameters', async () => {
    const p = store.createProject('Params');
    const s = store.addSource(p.id, 'website', 'https://example.com', 'x');
    const r = engine.start(p.id, 'slow', s.id);
    await new Promise((res) => setTimeout(res, 20));
    engine.cancel(p.id, r.id);
    await engine.idle(r.id);
    const wait = store.listSteps(p.id, r.id)[1]!;
    await engine.rerun(p.id, wait.id, { ms: 5 });
    expect(store.getStep(p.id, wait.id)!.params).toEqual({ ms: 5 });
    expect(store.getRun(p.id, r.id)!.status).toBe('succeeded');
  });

  it('marks in-flight work as interrupted after a restart', () => {
    const p = store.createProject('Restart');
    const s = store.addSource(p.id, 'website', 'https://example.com', 'x');
    const r = store.createRun(p.id, 'slow', s.id, [{ key: 'one', params: {} }]);
    store.startStep(store.listSteps(p.id, r.id)[0]!.id);
    expect(store.markInterrupted()).toBeGreaterThanOrEqual(1);
    expect(store.getRun(p.id, r.id)!.status).toBe('interrupted');
  });
});

describe('proposeName', () => {
  it('maps common custom-property names to canonical token names', () => {
    expect(proposeName({ id: 'space-4', type: 'dimension' })).toBe('space.4');
    expect(proposeName({ id: 'text-body', type: 'dimension' })).toBe('font.size.body');
    expect(proposeName({ id: 'font-sans', type: 'fontFamily' })).toBe('font.family.sans');
    expect(proposeName({ id: 'dur-micro', type: 'duration' })).toBe('motion.duration.micro');
    expect(proposeName({ id: 'radius', type: 'dimension' })).toBe('radius.default');
    expect(proposeName({ id: 'paper', type: 'color' })).toBe('color.paper');
    expect(proposeName({ id: 'tap', type: 'dimension' })).toBe('size.tap');
    expect(proposeName({ id: 'grid-line', type: 'other', value: '216 210 196' })).toBe('color.grid-line');
  });
});

describe('website import with a sandboxed browser render', () => {
  let server: import('node:http').Server;
  let base = '';
  let secretHits = 0;
  beforeAll(async () => {
    const { createServer } = await import('node:http');
    server = createServer((req, res) => {
      if (req.url === '/secret') {
        secretHits++;
        res.end('secret');
        return;
      }
      res.setHeader('content-type', 'text/html');
      // No stylesheet in the HTML: the styles only exist once the script runs.
      res.end(`<!doctype html><title>JS site</title><p class="x">Hello</p><script>
        const s = document.createElement('style');
        s.textContent = ':root{--brand:#ff0055;--gap:16px} .x{color:var(--brand);margin:var(--gap)}';
        document.head.append(s);
        fetch('http://localhost:${(server.address() as import('node:net').AddressInfo).port}/secret').catch(() => {});
      </script>`);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/`;
  });
  afterAll(() => server.close());

  it('captures styles built by JavaScript, saves a screenshot, and blocks calls to this computer', async () => {
    const p = (await call('POST', '/api/projects', { name: 'JS site', source: { kind: 'website', url: base } })).data;
    const sourceId = (p.sources as unknown as { id: string }[])[0]!.id;
    const r = (await call('POST', `/api/projects/${p.id}/runs`, { sourceId })).data;
    await engine.idle(r.id as string);
    const view = (await call('GET', `/api/projects/${p.id}/runs/${r.id}`)).data as unknown as RunView;
    expect(statuses(view)).toMatchObject({ 'import-source': 'succeeded', 'extract-tokens': 'succeeded' });
    const tokens = (view.steps.find((s) => s.key === 'extract-tokens')!.output as { proposals: { cssVar: string }[] })
      .proposals;
    expect(tokens.map((t) => t.cssVar).sort()).toEqual(['--brand', '--gap']);
    expect(secretHits).toBe(0);

    const arts = (await call('GET', `/api/projects/${p.id}/artifacts`)).data as unknown as {
      id: string;
      kind: string;
    }[];
    const shot = arts.find((a) => a.kind === 'screenshot')!;
    const res = await app.request(`/api/projects/${p.id}/artifacts/${shot.id}/raw`, { headers: { host: 'localhost' } });
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('content-disposition')).toBeNull();
    expect([...new Uint8Array(await res.arrayBuffer()).slice(1, 4)]).toEqual([0x50, 0x4e, 0x47]); // "PNG"
  }, 60_000);
});
