/** Typed client for the Studio server. All data comes from here; nothing is mocked. */
import type { Artifact, LogEntry, Project, Run, Source, Step } from '../../../server/db.ts';
import type { TokenProposal } from '../../../server/workflow/design-system.ts';

export type { Artifact, LogEntry, Project, Run, Source, Step, TokenProposal };

export interface ProjectListItem extends Project {
  sources: Source[];
  lastRun: Run | null;
  runCount: number;
}
export interface ProjectDetail extends Project {
  sources: Source[];
  runs: Run[];
  activeRunId: string | null;
  artifactCount: number;
}
export interface RunView extends Run {
  source: Source;
  steps: Step[];
}
export interface WorkflowStepDef {
  key: string;
  title: string;
  description: string;
  action: string;
  requiresApproval: boolean;
  approvalPrompt: string | null;
  params: Record<string, unknown>;
}
export interface WorkflowDef {
  id: string;
  title: string;
  steps: WorkflowStepDef[];
}
export interface ManifestToken {
  name: string;
  cssVar: string;
  type: string;
  value: unknown;
  css: string;
  description?: string;
  responsive?: { minWidth: number; value: string }[];
  provenance: { source: string; confidence: string; sourceValue?: string };
}
export type Foundations =
  | { status: 'none' }
  | { status: 'candidates'; runId: string; proposals: TokenProposal[] }
  | { status: 'built'; version: number; runId: string; tokens: ManifestToken[] };
export interface ComponentCandidateView {
  id: string;
  usedIn: number;
  uses: number;
  elements: string[];
  modifiers: string[];
  states: string[];
  styles: string[];
  notes: string[];
  /** Websites: the evidence is repetition on the page, not component files. */
  onPage?: boolean;
}
export type ComponentsResult =
  { status: 'none' } | { status: 'candidates'; runId: string; candidates: ComponentCandidateView[] };

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  workflows: () => req<WorkflowDef[]>('GET', '/workflows'),
  projects: () => req<ProjectListItem[]>('GET', '/projects'),
  createProject: (input: { name: string; description?: string; source?: { kind: Source['kind']; url: string } }) =>
    req<ProjectDetail>('POST', '/projects', input),
  project: (pid: string) => req<ProjectDetail>('GET', `/projects/${pid}`),
  updateProject: (pid: string, patch: { name?: string; description?: string }) =>
    req<Project>('PATCH', `/projects/${pid}`, patch),
  deleteProject: (pid: string, confirm: string) => req<{ deleted: string }>('DELETE', `/projects/${pid}`, { confirm }),
  addSource: (pid: string, input: { kind: Source['kind']; url: string }) =>
    req<Source>('POST', `/projects/${pid}/sources`, input),
  runs: (pid: string) => req<Run[]>('GET', `/projects/${pid}/runs`),
  run: (pid: string, rid: string) => req<RunView>('GET', `/projects/${pid}/runs/${rid}`),
  startRun: (pid: string, sourceId: string) => req<RunView>('POST', `/projects/${pid}/runs`, { sourceId }),
  cancelRun: (pid: string, rid: string) => req<RunView>('POST', `/projects/${pid}/runs/${rid}/cancel`),
  approve: (pid: string, sid: string, decision: unknown, note: string | null) =>
    req<RunView>('POST', `/projects/${pid}/steps/${sid}/approve`, { decision, note }),
  reject: (pid: string, sid: string, note: string | null) =>
    req<RunView>('POST', `/projects/${pid}/steps/${sid}/reject`, { note }),
  rerun: (pid: string, sid: string, params?: Record<string, unknown>) =>
    req<RunView>('POST', `/projects/${pid}/steps/${sid}/rerun`, params ? { params } : {}),
  logs: (pid: string, sid: string) => req<LogEntry[]>('GET', `/projects/${pid}/steps/${sid}/logs`),
  artifacts: (pid: string, filter: { runId?: string; stepId?: string } = {}) =>
    req<Artifact[]>('GET', `/projects/${pid}/artifacts?${new URLSearchParams(filter as Record<string, string>)}`),
  artifactUrl: (pid: string, aid: string, download = false) =>
    `/api/projects/${pid}/artifacts/${aid}/raw${download ? '?download=1' : ''}`,
  docsUrl: (pid: string, aid: string) => `/api/projects/${pid}/docs/${aid}`,
  artifactText: async (pid: string, aid: string) => {
    const res = await fetch(`/api/projects/${pid}/artifacts/${aid}/raw`);
    if (!res.ok) throw new ApiError(res.status, 'Could not open the artifact');
    return res.text();
  },
  foundations: (pid: string) => req<Foundations>('GET', `/projects/${pid}/foundations`),
  components: (pid: string) => req<ComponentsResult>('GET', `/projects/${pid}/components`),
};
