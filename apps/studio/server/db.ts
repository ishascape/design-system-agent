/**
 * Persistent storage for the Studio: one SQLite file (Node's built-in node:sqlite, no native
 * install). Every record that belongs to a project carries project_id, and every query that reads
 * project data filters by it, so projects can never see each other's data.
 */
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';

export type SourceKind = 'github' | 'website' | 'figma' | 'package';
export type RunStatus =
  'running' | 'awaiting-approval' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted' | 'blocked' | 'rejected';
export type StepStatus =
  | 'pending'
  | 'running'
  | 'awaiting-approval'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'interrupted'
  | 'blocked'
  | 'rejected';

export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}
export interface Source {
  id: string;
  projectId: string;
  kind: SourceKind;
  url: string;
  label: string;
  createdAt: string;
}
export interface Run {
  id: string;
  projectId: string;
  number: number;
  workflow: string;
  sourceId: string;
  status: RunStatus;
  createdAt: string;
  finishedAt: string | null;
}
export interface Step {
  id: string;
  runId: string;
  projectId: string;
  key: string;
  position: number;
  status: StepStatus;
  attempt: number;
  params: Record<string, unknown>;
  startedAt: string | null;
  finishedAt: string | null;
  summary: StepSummary | null;
  output: unknown;
  error: string | null;
  decision: 'approved' | 'rejected' | null;
  decisionNote: string | null;
  decidedAt: string | null;
}
export interface StepSummary {
  headline: string;
  facts: { label: string; value: string }[];
  warnings: string[];
}
export interface LogEntry {
  id: number;
  stepId: string;
  attempt: number;
  ts: string;
  level: 'info' | 'warn' | 'error';
  message: string;
}
export interface Artifact {
  id: string;
  projectId: string;
  runId: string;
  stepId: string;
  kind: string;
  version: number;
  path: string;
  mediaType: string;
  bytes: number;
  createdAt: string;
}

/** Stable, prefixed, unguessable ids, e.g. prj_3f9a1c2b7d4e. */
export const newId = (prefix: string) => `${prefix}_${randomBytes(8).toString('hex')}`;
const now = () => new Date().toISOString();

const SCHEMA = `
create table if not exists meta (key text primary key, value text not null);
create table if not exists projects (
  id text primary key, name text not null, description text not null default '',
  created_at text not null, updated_at text not null
);
create table if not exists sources (
  id text primary key, project_id text not null references projects(id) on delete cascade,
  kind text not null, url text not null, label text not null, created_at text not null
);
create table if not exists runs (
  id text primary key, project_id text not null references projects(id) on delete cascade,
  number integer not null, workflow text not null, source_id text not null references sources(id),
  status text not null, created_at text not null, finished_at text,
  unique (project_id, number)
);
create table if not exists steps (
  id text primary key, run_id text not null references runs(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  key text not null, position integer not null, status text not null, attempt integer not null default 0,
  params text not null default '{}', started_at text, finished_at text, summary text, output text,
  error text, decision text, decision_note text, decided_at text,
  unique (run_id, key)
);
create table if not exists logs (
  id integer primary key autoincrement, step_id text not null references steps(id) on delete cascade,
  project_id text not null, attempt integer not null, ts text not null, level text not null, message text not null
);
create table if not exists artifacts (
  id text primary key, project_id text not null references projects(id) on delete cascade,
  run_id text not null, step_id text not null, kind text not null, version integer not null,
  path text not null, media_type text not null, bytes integer not null, created_at text not null,
  unique (project_id, kind, version)
);
create index if not exists idx_runs_project on runs(project_id, number);
create index if not exists idx_steps_run on steps(run_id, position);
create index if not exists idx_logs_step on logs(step_id, id);
create index if not exists idx_artifacts_project on artifacts(project_id, kind, version);
`;

type Row = Record<string, unknown>;
const json = <T>(v: unknown, fallback: T): T => (typeof v === 'string' ? (JSON.parse(v) as T) : fallback);

const toProject = (r: Row): Project => ({
  id: r.id as string,
  name: r.name as string,
  description: r.description as string,
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
});
const toSource = (r: Row): Source => ({
  id: r.id as string,
  projectId: r.project_id as string,
  kind: r.kind as SourceKind,
  url: r.url as string,
  label: r.label as string,
  createdAt: r.created_at as string,
});
const toRun = (r: Row): Run => ({
  id: r.id as string,
  projectId: r.project_id as string,
  number: Number(r.number),
  workflow: r.workflow as string,
  sourceId: r.source_id as string,
  status: r.status as RunStatus,
  createdAt: r.created_at as string,
  finishedAt: (r.finished_at as string | null) ?? null,
});
const toStep = (r: Row): Step => ({
  id: r.id as string,
  runId: r.run_id as string,
  projectId: r.project_id as string,
  key: r.key as string,
  position: Number(r.position),
  status: r.status as StepStatus,
  attempt: Number(r.attempt),
  params: json(r.params, {}),
  startedAt: (r.started_at as string | null) ?? null,
  finishedAt: (r.finished_at as string | null) ?? null,
  summary: json<StepSummary | null>(r.summary, null),
  output: json<unknown>(r.output, null),
  error: (r.error as string | null) ?? null,
  decision: (r.decision as Step['decision']) ?? null,
  decisionNote: (r.decision_note as string | null) ?? null,
  decidedAt: (r.decided_at as string | null) ?? null,
});
const toArtifact = (r: Row): Artifact => ({
  id: r.id as string,
  projectId: r.project_id as string,
  runId: r.run_id as string,
  stepId: r.step_id as string,
  kind: r.kind as string,
  version: Number(r.version),
  path: r.path as string,
  mediaType: r.media_type as string,
  bytes: Number(r.bytes),
  createdAt: r.created_at as string,
});

export class Store {
  readonly db: DatabaseSync;
  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec('pragma journal_mode = wal; pragma foreign_keys = on;');
    this.db.exec(SCHEMA);
    this.db.prepare("insert or ignore into meta (key, value) values ('schema_version', '1')").run();
  }

  tx<T>(fn: () => T): T {
    this.db.exec('begin');
    try {
      const r = fn();
      this.db.exec('commit');
      return r;
    } catch (e) {
      this.db.exec('rollback');
      throw e;
    }
  }

  // ---------- Projects ----------
  listProjects(): Project[] {
    return this.db
      .prepare('select * from projects order by updated_at desc')
      .all()
      .map((r) => toProject(r as Row));
  }
  getProject(id: string): Project | undefined {
    const r = this.db.prepare('select * from projects where id = ?').get(id);
    return r ? toProject(r as Row) : undefined;
  }
  createProject(name: string, description = ''): Project {
    const id = newId('prj');
    const t = now();
    this.db
      .prepare('insert into projects (id, name, description, created_at, updated_at) values (?, ?, ?, ?, ?)')
      .run(id, name, description, t, t);
    return this.getProject(id)!;
  }
  updateProject(id: string, patch: { name?: string; description?: string }): Project | undefined {
    const p = this.getProject(id);
    if (!p) return undefined;
    this.db
      .prepare('update projects set name = ?, description = ?, updated_at = ? where id = ?')
      .run(patch.name ?? p.name, patch.description ?? p.description, now(), id);
    return this.getProject(id);
  }
  touchProject(id: string) {
    this.db.prepare('update projects set updated_at = ? where id = ?').run(now(), id);
  }
  deleteProject(id: string): boolean {
    return this.db.prepare('delete from projects where id = ?').run(id).changes > 0;
  }

  // ---------- Sources ----------
  listSources(projectId: string): Source[] {
    return this.db
      .prepare('select * from sources where project_id = ? order by created_at')
      .all(projectId)
      .map((r) => toSource(r as Row));
  }
  getSource(projectId: string, id: string): Source | undefined {
    const r = this.db.prepare('select * from sources where project_id = ? and id = ?').get(projectId, id);
    return r ? toSource(r as Row) : undefined;
  }
  addSource(projectId: string, kind: SourceKind, url: string, label: string): Source {
    const id = newId('src');
    this.db
      .prepare('insert into sources (id, project_id, kind, url, label, created_at) values (?, ?, ?, ?, ?, ?)')
      .run(id, projectId, kind, url, label, now());
    this.touchProject(projectId);
    return this.getSource(projectId, id)!;
  }

  // ---------- Runs and steps ----------
  listRuns(projectId: string): Run[] {
    return this.db
      .prepare('select * from runs where project_id = ? order by number desc')
      .all(projectId)
      .map((r) => toRun(r as Row));
  }
  getRun(projectId: string, id: string): Run | undefined {
    const r = this.db.prepare('select * from runs where project_id = ? and id = ?').get(projectId, id);
    return r ? toRun(r as Row) : undefined;
  }
  activeRun(projectId: string): Run | undefined {
    const r = this.db
      .prepare("select * from runs where project_id = ? and status in ('running', 'awaiting-approval') limit 1")
      .get(projectId);
    return r ? toRun(r as Row) : undefined;
  }
  createRun(
    projectId: string,
    workflow: string,
    sourceId: string,
    steps: { key: string; params: Record<string, unknown> }[],
  ): Run {
    return this.tx(() => {
      const id = newId('run');
      const n = this.db
        .prepare('select coalesce(max(number), 0) + 1 as n from runs where project_id = ?')
        .get(projectId) as {
        n: number;
      };
      this.db
        .prepare(
          "insert into runs (id, project_id, number, workflow, source_id, status, created_at) values (?, ?, ?, ?, ?, 'running', ?)",
        )
        .run(id, projectId, n.n, workflow, sourceId, now());
      const ins = this.db.prepare(
        "insert into steps (id, run_id, project_id, key, position, status, params) values (?, ?, ?, ?, ?, 'pending', ?)",
      );
      steps.forEach((s, i) => ins.run(newId('stp'), id, projectId, s.key, i, JSON.stringify(s.params)));
      this.touchProject(projectId);
      return this.getRun(projectId, id)!;
    });
  }
  setRunStatus(runId: string, status: RunStatus) {
    const final = !['running', 'awaiting-approval'].includes(status);
    this.db
      .prepare('update runs set status = ?, finished_at = ? where id = ?')
      .run(status, final ? now() : null, runId);
  }
  listSteps(projectId: string, runId: string): Step[] {
    return this.db
      .prepare('select * from steps where project_id = ? and run_id = ? order by position')
      .all(projectId, runId)
      .map((r) => toStep(r as Row));
  }
  getStep(projectId: string, id: string): Step | undefined {
    const r = this.db.prepare('select * from steps where project_id = ? and id = ?').get(projectId, id);
    return r ? toStep(r as Row) : undefined;
  }
  startStep(id: string) {
    this.db
      .prepare(
        "update steps set status = 'running', attempt = attempt + 1, started_at = ?, finished_at = null, error = null, summary = null, output = null, decision = null, decision_note = null, decided_at = null where id = ?",
      )
      .run(now(), id);
  }
  finishStep(id: string, status: StepStatus, fields: { summary?: StepSummary; output?: unknown; error?: string }) {
    this.db
      .prepare(
        'update steps set status = ?, finished_at = ?, summary = coalesce(?, summary), output = coalesce(?, output), error = ? where id = ?',
      )
      .run(
        status,
        now(),
        fields.summary ? JSON.stringify(fields.summary) : null,
        fields.output === undefined ? null : JSON.stringify(fields.output),
        fields.error ?? null,
        id,
      );
  }
  decideStep(id: string, decision: 'approved' | 'rejected', note: string | null) {
    this.db
      .prepare('update steps set decision = ?, decision_note = ?, decided_at = ? where id = ?')
      .run(decision, note, now(), id);
  }
  setStepStatus(id: string, status: StepStatus) {
    this.db.prepare('update steps set status = ? where id = ?').run(status, id);
  }
  setStepParams(id: string, params: Record<string, unknown>) {
    this.db.prepare('update steps set params = ? where id = ?').run(JSON.stringify(params), id);
  }
  /** Resets a step and everything after it to pending, because their inputs are now stale. */
  resetFrom(runId: string, position: number) {
    this.db
      .prepare(
        "update steps set status = 'pending', summary = null, output = null, error = null, decision = null, decision_note = null, decided_at = null, started_at = null, finished_at = null where run_id = ? and position >= ?",
      )
      .run(runId, position);
  }
  /** After a restart nothing is running any more; mark what was in flight so it can be retried. */
  markInterrupted(): number {
    return this.tx(() => {
      const n = this.db
        .prepare("update steps set status = 'interrupted', finished_at = ? where status = 'running'")
        .run(now()).changes;
      this.db.prepare("update runs set status = 'interrupted', finished_at = ? where status = 'running'").run(now());
      return Number(n);
    });
  }

  // ---------- Logs ----------
  log(projectId: string, stepId: string, attempt: number, level: LogEntry['level'], message: string) {
    this.db
      .prepare('insert into logs (step_id, project_id, attempt, ts, level, message) values (?, ?, ?, ?, ?, ?)')
      .run(stepId, projectId, attempt, now(), level, message);
  }
  listLogs(projectId: string, stepId: string): LogEntry[] {
    return this.db
      .prepare(
        'select id, step_id, attempt, ts, level, message from logs where project_id = ? and step_id = ? order by id',
      )
      .all(projectId, stepId)
      .map((r) => {
        const x = r as Row;
        return {
          id: Number(x.id),
          stepId: x.step_id as string,
          attempt: Number(x.attempt),
          ts: x.ts as string,
          level: x.level as LogEntry['level'],
          message: x.message as string,
        };
      });
  }

  // ---------- Artifacts ----------
  nextArtifactVersion(projectId: string, kind: string): number {
    const r = this.db
      .prepare('select coalesce(max(version), 0) + 1 as v from artifacts where project_id = ? and kind = ?')
      .get(projectId, kind) as { v: number };
    return Number(r.v);
  }
  addArtifact(a: Omit<Artifact, 'id' | 'createdAt'>): Artifact {
    const id = newId('art');
    this.db
      .prepare(
        'insert into artifacts (id, project_id, run_id, step_id, kind, version, path, media_type, bytes, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, a.projectId, a.runId, a.stepId, a.kind, a.version, a.path, a.mediaType, a.bytes, now());
    return this.getArtifact(a.projectId, id)!;
  }
  getArtifact(projectId: string, id: string): Artifact | undefined {
    const r = this.db.prepare('select * from artifacts where project_id = ? and id = ?').get(projectId, id);
    return r ? toArtifact(r as Row) : undefined;
  }
  listArtifacts(projectId: string, filter: { runId?: string; stepId?: string } = {}): Artifact[] {
    let sql = 'select * from artifacts where project_id = ?';
    const args: string[] = [projectId];
    if (filter.runId) {
      sql += ' and run_id = ?';
      args.push(filter.runId);
    }
    if (filter.stepId) {
      sql += ' and step_id = ?';
      args.push(filter.stepId);
    }
    sql += ' order by created_at desc, version desc';
    return this.db
      .prepare(sql)
      .all(...args)
      .map((r) => toArtifact(r as Row));
  }
  latestArtifact(projectId: string, kind: string): Artifact | undefined {
    const r = this.db
      .prepare('select * from artifacts where project_id = ? and kind = ? order by version desc limit 1')
      .get(projectId, kind);
    return r ? toArtifact(r as Row) : undefined;
  }
}
