/**
 * The Studio's HTTP API. Every project route checks that the project exists, and every nested
 * record is looked up with its project id, so one project's ids never resolve in another.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import type { SourceKind, Store } from './db.ts';
import { validateSourceUrl } from './sources.ts';
import { Engine, WorkflowError, type EngineEvent } from './workflow/engine.ts';
import type { WorkflowDefinition } from './workflow/types.ts';

const SourceInput = z.object({
  kind: z.enum(['github', 'website', 'figma', 'package']),
  url: z.string().trim().min(1),
  label: z.string().trim().max(80).optional(),
});
const ProjectInput = z.object({
  name: z.string().trim().min(1, 'Give the project a name').max(80),
  description: z.string().trim().max(500).default(''),
  source: SourceInput.optional(),
});

const TEXT_TYPES = new Set(['application/json', 'text/markdown', 'text/css', 'text/plain', 'text/javascript']);

export interface AppDeps {
  store: Store;
  engine: Engine;
  workflows: Record<string, WorkflowDefinition>;
  projectDir: (projectId: string) => string;
  /** Hostnames the server answers to (protects against DNS rebinding). */
  allowedHosts: string[];
}

export function createApp({ store, engine, workflows, projectDir, allowedHosts }: AppDeps) {
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof WorkflowError) return c.json({ error: err.message }, err.status as 400);
    if (err instanceof z.ZodError) return c.json({ error: z.prettifyError(err) }, 400);
    console.error(err);
    return c.json({ error: 'Something went wrong on the Studio server. The details are in its terminal.' }, 500);
  });

  // Local-only app: refuse requests addressed to other hostnames, and cross-site writes.
  app.use('/api/*', async (c, next) => {
    const host = (c.req.header('host') ?? '').replace(/:\d+$/, '');
    if (!allowedHosts.includes(host)) return c.json({ error: 'Forbidden host' }, 403);
    const origin = c.req.header('origin');
    if (c.req.method !== 'GET' && origin) {
      const o = new URL(origin).hostname;
      if (!allowedHosts.includes(o)) return c.json({ error: 'Forbidden origin' }, 403);
    }
    await next();
  });

  const project = (c: Context) => {
    const p = store.getProject(c.req.param('pid') ?? '');
    if (!p) throw new WorkflowError(404, 'Project not found');
    return p;
  };
  const body = async (c: Context) => {
    try {
      return (await c.req.json()) as unknown;
    } catch {
      return {};
    }
  };
  const addSource = (projectId: string, s: z.infer<typeof SourceInput>) => {
    const problem = validateSourceUrl(s.kind as SourceKind, s.url);
    if (problem) throw new WorkflowError(400, problem);
    return store.addSource(
      projectId,
      s.kind,
      s.url,
      s.label || new URL(s.url).hostname + new URL(s.url).pathname.replace(/\/$/, ''),
    );
  };

  app.get('/api/health', (c) => c.json({ ok: true }));

  app.get('/api/workflows', (c) =>
    c.json(
      Object.values(workflows).map((w) => ({
        id: w.id,
        title: w.title,
        steps: w.steps.map((s) => ({
          key: s.key,
          title: s.title,
          description: s.description,
          action: s.action,
          requiresApproval: !!s.approval,
          approvalPrompt: s.approval?.prompt ?? null,
          params: s.params ? s.params.parse({}) : {},
        })),
      })),
    ),
  );

  // ---------- Projects ----------
  app.get('/api/projects', (c) =>
    c.json(
      store.listProjects().map((p) => {
        const runs = store.listRuns(p.id);
        return { ...p, sources: store.listSources(p.id), lastRun: runs[0] ?? null, runCount: runs.length };
      }),
    ),
  );
  app.post('/api/projects', async (c) => {
    const input = ProjectInput.parse(await body(c));
    if (input.source) {
      const problem = validateSourceUrl(input.source.kind, input.source.url);
      if (problem) throw new WorkflowError(400, problem);
    }
    const p = store.createProject(input.name, input.description);
    if (input.source) addSource(p.id, input.source);
    return c.json({ ...p, sources: store.listSources(p.id) }, 201);
  });
  app.get('/api/projects/:pid', (c) => {
    const p = project(c);
    const runs = store.listRuns(p.id);
    return c.json({
      ...p,
      sources: store.listSources(p.id),
      runs: runs.slice(0, 20),
      activeRunId: store.activeRun(p.id)?.id ?? null,
      artifactCount: store.listArtifacts(p.id).length,
    });
  });
  app.patch('/api/projects/:pid', async (c) => {
    const p = project(c);
    const input = z
      .object({ name: z.string().trim().min(1).max(80).optional(), description: z.string().max(500).optional() })
      .parse(await body(c));
    const patch: { name?: string; description?: string } = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined) patch.description = input.description;
    return c.json(store.updateProject(p.id, patch));
  });
  app.delete('/api/projects/:pid', async (c) => {
    const p = project(c);
    const { confirm } = z.object({ confirm: z.string() }).parse(await body(c));
    if (confirm !== p.name) throw new WorkflowError(400, 'Type the project name exactly to delete it');
    if (store.activeRun(p.id)) throw new WorkflowError(409, 'Cancel the run in progress first');
    store.deleteProject(p.id);
    return c.json({ deleted: p.id });
  });
  app.post('/api/projects/:pid/sources', async (c) => {
    const p = project(c);
    return c.json(addSource(p.id, SourceInput.parse(await body(c))), 201);
  });

  // ---------- Runs ----------
  const runView = (projectId: string, runId: string) => {
    const run = store.getRun(projectId, runId);
    if (!run) throw new WorkflowError(404, 'Run not found');
    return { ...run, source: store.getSource(projectId, run.sourceId), steps: store.listSteps(projectId, runId) };
  };
  app.get('/api/projects/:pid/runs', (c) => c.json(store.listRuns(project(c).id)));
  app.post('/api/projects/:pid/runs', async (c) => {
    const p = project(c);
    const input = z
      .object({ sourceId: z.string(), workflow: z.string().default('design-system-v1') })
      .parse(await body(c));
    const run = engine.start(p.id, input.workflow, input.sourceId);
    return c.json(runView(p.id, run.id), 201);
  });
  app.get('/api/projects/:pid/runs/:rid', (c) => c.json(runView(project(c).id, c.req.param('rid'))));
  app.post('/api/projects/:pid/runs/:rid/cancel', (c) => {
    const p = project(c);
    engine.cancel(p.id, c.req.param('rid'));
    return c.json(runView(p.id, c.req.param('rid')));
  });

  // ---------- Steps ----------
  const stepOf = (projectId: string, id: string) => {
    const s = store.getStep(projectId, id);
    if (!s) throw new WorkflowError(404, 'Step not found');
    return s;
  };
  app.post('/api/projects/:pid/steps/:sid/approve', async (c) => {
    const p = project(c);
    const s = stepOf(p.id, c.req.param('sid'));
    const input = z
      .object({ decision: z.unknown().optional(), note: z.string().max(1000).nullable().default(null) })
      .parse(await body(c));
    await engine.approve(p.id, s.id, input.decision ?? {}, input.note);
    return c.json(runView(p.id, s.runId));
  });
  app.post('/api/projects/:pid/steps/:sid/reject', async (c) => {
    const p = project(c);
    const s = stepOf(p.id, c.req.param('sid'));
    const input = z.object({ note: z.string().max(1000).nullable().default(null) }).parse(await body(c));
    engine.reject(p.id, s.id, input.note);
    return c.json(runView(p.id, s.runId));
  });
  app.post('/api/projects/:pid/steps/:sid/rerun', async (c) => {
    const p = project(c);
    const s = stepOf(p.id, c.req.param('sid'));
    const input = z.object({ params: z.record(z.string(), z.unknown()).optional() }).parse(await body(c));
    void engine.rerun(p.id, s.id, input.params);
    return c.json(runView(p.id, s.runId));
  });
  app.get('/api/projects/:pid/steps/:sid/logs', (c) => {
    const p = project(c);
    const s = stepOf(p.id, c.req.param('sid'));
    return c.json(store.listLogs(p.id, s.id));
  });

  // ---------- Artifacts ----------
  app.get('/api/projects/:pid/artifacts', (c) => {
    const p = project(c);
    const runId = c.req.query('runId');
    const stepId = c.req.query('stepId');
    return c.json(store.listArtifacts(p.id, { ...(runId ? { runId } : {}), ...(stepId ? { stepId } : {}) }));
  });
  app.get('/api/projects/:pid/artifacts/:aid/raw', (c) => {
    const p = project(c);
    const a = store.getArtifact(p.id, c.req.param('aid'));
    if (!a) throw new WorkflowError(404, 'Artifact not found');
    const base = resolve(projectDir(p.id));
    const file = resolve(base, a.path);
    if (!file.startsWith(base + '/') || !existsSync(file)) throw new WorkflowError(404, 'Artifact file is missing');
    const isText = TEXT_TYPES.has(a.mediaType);
    // Artifacts come from untrusted sources: never render them as HTML in the Studio's origin.
    c.header('content-type', isText ? 'text/plain; charset=utf-8' : 'application/octet-stream');
    c.header('x-content-type-options', 'nosniff');
    c.header('content-security-policy', "default-src 'none'; sandbox");
    if (c.req.query('download') || !isText)
      c.header('content-disposition', `attachment; filename="${a.path.split('/').pop()}"`);
    return c.body(readFileSync(file));
  });

  /** The project's current foundations: the latest built manifest, else the latest candidates. */
  app.get('/api/projects/:pid/foundations', (c) => {
    const p = project(c);
    const manifest = store.latestArtifact(p.id, 'tokens-manifest');
    if (manifest) {
      return c.json({
        status: 'built',
        version: manifest.version,
        runId: manifest.runId,
        tokens: JSON.parse(readFileSync(join(projectDir(p.id), manifest.path), 'utf8')),
      });
    }
    const runs = store.listRuns(p.id);
    for (const r of runs) {
      const s = store.listSteps(p.id, r.id).find((x) => x.key === 'extract-tokens' && x.status === 'succeeded');
      if (s)
        return c.json({
          status: 'candidates',
          runId: r.id,
          proposals: (s.output as { proposals: unknown[] }).proposals,
        });
    }
    return c.json({ status: 'none' });
  });
  app.get('/api/projects/:pid/components', (c) => {
    const p = project(c);
    for (const r of store.listRuns(p.id)) {
      const s = store.listSteps(p.id, r.id).find((x) => x.key === 'identify-components' && x.status === 'succeeded');
      if (s)
        return c.json({
          status: 'candidates',
          runId: r.id,
          candidates: (s.output as { candidates: unknown[] }).candidates,
        });
    }
    return c.json({ status: 'none' });
  });

  // ---------- Live updates ----------
  app.get('/api/projects/:pid/events', (c) => {
    const p = project(c);
    return streamSSE(c, async (stream) => {
      const onChange = (e: EngineEvent) => {
        if (e.projectId === p.id) void stream.writeSSE({ event: 'change', data: JSON.stringify(e) });
      };
      engine.events.on('change', onChange);
      stream.onAbort(() => {
        engine.events.off('change', onChange);
      });
      await stream.writeSSE({ event: 'ready', data: '{}' });
      while (!stream.aborted) {
        await stream.sleep(25_000);
        if (!stream.aborted) await stream.writeSSE({ event: 'ping', data: '{}' });
      }
    });
  });

  return app;
}
