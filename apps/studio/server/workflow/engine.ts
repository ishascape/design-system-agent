/**
 * Runs workflows. State lives in the database, not in memory: the engine reads the next step to
 * do from the stored run, executes it, and writes the result back. That makes runs resumable
 * after a restart, retryable per step, and observable by the UI through change events.
 *
 * Rules:
 * - One active run per project.
 * - Steps run strictly in order. A step that needs approval pauses the run.
 * - Retrying or re-running a step resets it and every later step, because their inputs change.
 * - Cancel aborts the running step through its AbortSignal and marks the run cancelled.
 */
import { EventEmitter } from 'node:events';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Store, Step } from '../db.ts';
import { StepBlocked, type StepContext, type WorkflowDefinition } from './types.ts';

export class WorkflowError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface EngineEvent {
  projectId: string;
  runId: string;
  stepId?: string;
  type: 'run' | 'step' | 'log';
}

export class Engine {
  readonly events = new EventEmitter();
  private readonly running = new Map<string, AbortController>();
  private readonly loops = new Map<string, Promise<void>>();

  private readonly store: Store;
  private readonly workflows: Record<string, WorkflowDefinition>;
  private readonly projectDir: (projectId: string) => string;

  constructor(store: Store, workflows: Record<string, WorkflowDefinition>, projectDir: (projectId: string) => string) {
    this.store = store;
    this.workflows = workflows;
    this.projectDir = projectDir;
    this.events.setMaxListeners(100);
  }

  private emit(e: EngineEvent) {
    this.events.emit('change', e);
  }

  private def(workflow: string): WorkflowDefinition {
    const w = this.workflows[workflow];
    if (!w) throw new WorkflowError(400, `Unknown workflow ${workflow}`);
    return w;
  }

  /** Starts a new run of a workflow for a project's source. */
  start(projectId: string, workflow: string, sourceId: string) {
    const w = this.def(workflow);
    if (!this.store.getProject(projectId)) throw new WorkflowError(404, 'Project not found');
    if (!this.store.getSource(projectId, sourceId)) throw new WorkflowError(404, 'Source not found');
    if (this.store.activeRun(projectId)) throw new WorkflowError(409, 'This project already has a run in progress');
    const run = this.store.createRun(
      projectId,
      w.id,
      sourceId,
      w.steps.map((s) => ({ key: s.key, params: s.params ? s.params.parse({}) : {} })),
    );
    this.emit({ projectId, runId: run.id, type: 'run' });
    this.kick(projectId, run.id);
    return run;
  }

  /** Continues a run from its first unfinished step. Safe to call more than once. */
  kick(projectId: string, runId: string) {
    if (this.loops.has(runId)) return this.loops.get(runId)!;
    const p = this.loop(projectId, runId).finally(() => this.loops.delete(runId));
    this.loops.set(runId, p);
    return p;
  }

  /** Resolves when the run has nothing left to do right now (finished, paused or failed). */
  idle(runId: string) {
    return this.loops.get(runId) ?? Promise.resolve();
  }

  private async loop(projectId: string, runId: string) {
    const run = this.store.getRun(projectId, runId);
    if (!run) return;
    const w = this.def(run.workflow);
    for (;;) {
      const steps = this.store.listSteps(projectId, runId);
      const optional = new Set(w.steps.filter((d) => d.optional).map((d) => d.key));
      const skippable = (s: Step) => s.status === 'blocked' && optional.has(s.key);
      const next = steps.find((s) => s.status !== 'succeeded' && !skippable(s));
      if (!next) {
        // Finished; if an optional stage was not available, the run says so rather than "succeeded".
        this.store.setRunStatus(runId, steps.some(skippable) ? 'blocked' : 'succeeded');
        this.emit({ projectId, runId, type: 'run' });
        return;
      }
      if (next.status !== 'pending') {
        const runStatus =
          next.status === 'awaiting-approval'
            ? 'awaiting-approval'
            : next.status === 'running'
              ? 'running'
              : (next.status as 'failed' | 'cancelled' | 'interrupted' | 'blocked' | 'rejected');
        this.store.setRunStatus(runId, runStatus);
        this.emit({ projectId, runId, type: 'run' });
        return;
      }
      this.store.setRunStatus(runId, 'running');
      await this.execute(projectId, runId, next, w);
    }
  }

  private context(projectId: string, runId: string, step: Step, signal: AbortSignal): StepContext {
    const project = this.store.getProject(projectId)!;
    const run = this.store.getRun(projectId, runId)!;
    const source = this.store.getSource(projectId, run.sourceId)!;
    const outputs = Object.fromEntries(
      this.store
        .listSteps(projectId, runId)
        .filter((s) => s.position < step.position && s.status === 'succeeded')
        .map((s) => [s.key, s.output]),
    );
    const workspace = this.projectDir(projectId);
    const fresh = this.store.getStep(projectId, step.id)!;
    return {
      project,
      source,
      runId,
      runNumber: run.number,
      stepId: step.id,
      attempt: fresh.attempt,
      params: fresh.params,
      outputs,
      workspace,
      signal,
      log: (message, level = 'info') => {
        this.store.log(projectId, step.id, fresh.attempt, level, message);
        this.emit({ projectId, runId, stepId: step.id, type: 'log' });
      },
      saveArtifact: (kind, fileName, content, mediaType) => {
        if (!/^[a-z0-9-]+$/.test(kind) || !/^[A-Za-z0-9._-]+$/.test(fileName))
          throw new Error(`Unsafe artifact name ${kind}/${fileName}`);
        const version = this.store.nextArtifactVersion(projectId, kind);
        const rel = join('artifacts', kind, `v${version}`, fileName);
        mkdirSync(join(workspace, 'artifacts', kind, `v${version}`), { recursive: true });
        const buf = typeof content === 'string' ? Buffer.from(content) : content;
        writeFileSync(join(workspace, rel), buf);
        return this.store.addArtifact({
          projectId,
          runId,
          stepId: step.id,
          kind,
          version,
          path: rel,
          mediaType,
          bytes: buf.length,
        });
      },
    };
  }

  private async execute(projectId: string, runId: string, step: Step, w: WorkflowDefinition) {
    const def = w.steps.find((s) => s.key === step.key);
    if (!def) throw new Error(`Workflow ${w.id} has no step ${step.key}`);
    const ac = new AbortController();
    this.running.set(runId, ac);
    this.store.startStep(step.id);
    this.emit({ projectId, runId, stepId: step.id, type: 'step' });
    const ctx = this.context(projectId, runId, step, ac.signal);
    ctx.log(`${def.title}: started (attempt ${ctx.attempt})`);
    try {
      const params = def.params ? def.params.parse(ctx.params) : ctx.params;
      const result = await def.run({ ...ctx, params });
      if (ac.signal.aborted) throw ac.signal.reason ?? new Error('Cancelled');
      if (def.approval) {
        this.store.finishStep(step.id, 'awaiting-approval', result);
        ctx.log(`Waiting for approval: ${def.approval.prompt}`);
      } else {
        this.store.finishStep(step.id, 'succeeded', result);
        ctx.log(`${def.title}: done`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (ac.signal.aborted) {
        this.store.finishStep(step.id, 'cancelled', { error: 'Cancelled by you' });
        ctx.log('Cancelled', 'warn');
      } else if (e instanceof StepBlocked) {
        this.store.finishStep(step.id, 'blocked', { error: msg });
        ctx.log(msg, 'warn');
      } else {
        this.store.finishStep(step.id, 'failed', { error: msg });
        ctx.log(msg, 'error');
      }
    } finally {
      this.running.delete(runId);
      this.emit({ projectId, runId, stepId: step.id, type: 'step' });
    }
  }

  async approve(projectId: string, stepId: string, decision: unknown, note: string | null) {
    const step = this.store.getStep(projectId, stepId);
    if (!step) throw new WorkflowError(404, 'Step not found');
    if (step.status !== 'awaiting-approval') throw new WorkflowError(409, 'This step is not waiting for approval');
    const run = this.store.getRun(projectId, step.runId)!;
    const def = this.def(run.workflow).steps.find((s) => s.key === step.key)!;
    const ac = new AbortController();
    const ctx = this.context(projectId, run.id, step, ac.signal);
    try {
      const result = await def.approval!.onApprove({ ...ctx, pending: step.output, decision });
      this.store.decideStep(stepId, 'approved', note);
      this.store.finishStep(stepId, 'succeeded', result);
      ctx.log(`Approved${note ? `: ${note}` : ''}`);
    } catch (e) {
      // A bad decision payload or a failed write keeps the step waiting, so nothing is lost.
      const msg = e instanceof Error ? e.message : String(e);
      ctx.log(`Approval could not be applied: ${msg}`, 'error');
      throw new WorkflowError(400, msg);
    }
    this.emit({ projectId, runId: run.id, stepId, type: 'step' });
    await this.kick(projectId, run.id);
  }

  reject(projectId: string, stepId: string, note: string | null) {
    const step = this.store.getStep(projectId, stepId);
    if (!step) throw new WorkflowError(404, 'Step not found');
    if (step.status !== 'awaiting-approval') throw new WorkflowError(409, 'This step is not waiting for approval');
    this.store.decideStep(stepId, 'rejected', note);
    this.store.setStepStatus(stepId, 'rejected');
    this.store.log(projectId, stepId, step.attempt, 'warn', `Rejected${note ? `: ${note}` : ''}`);
    this.store.setRunStatus(step.runId, 'rejected');
    this.emit({ projectId, runId: step.runId, stepId, type: 'step' });
  }

  /** Re-runs a step (optionally with new parameters) and invalidates every later step. */
  rerun(projectId: string, stepId: string, params?: Record<string, unknown>) {
    const step = this.store.getStep(projectId, stepId);
    if (!step) throw new WorkflowError(404, 'Step not found');
    const run = this.store.getRun(projectId, step.runId)!;
    if (this.running.has(run.id))
      throw new WorkflowError(409, 'Wait for the current step to finish, or cancel the run');
    const other = this.store.activeRun(projectId);
    if (other && other.id !== run.id) throw new WorkflowError(409, 'Another run of this project is in progress');
    const def = this.def(run.workflow).steps.find((s) => s.key === step.key)!;
    if (params) {
      const parsed = def.params ? def.params.parse(params) : {};
      this.store.setStepParams(stepId, parsed);
    }
    this.store.resetFrom(run.id, step.position);
    this.store.setRunStatus(run.id, 'running');
    this.emit({ projectId, runId: run.id, stepId, type: 'run' });
    return this.kick(projectId, run.id);
  }

  cancel(projectId: string, runId: string) {
    const run = this.store.getRun(projectId, runId);
    if (!run) throw new WorkflowError(404, 'Run not found');
    const ac = this.running.get(runId);
    if (ac) ac.abort(new Error('Cancelled'));
    else if (['running', 'awaiting-approval'].includes(run.status)) {
      const waiting = this.store.listSteps(projectId, runId).find((s) => s.status === 'awaiting-approval');
      if (waiting) this.store.setStepStatus(waiting.id, 'cancelled');
      this.store.setRunStatus(runId, 'cancelled');
      this.emit({ projectId, runId, type: 'run' });
    } else throw new WorkflowError(409, 'This run is not in progress');
  }
}
