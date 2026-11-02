import type { RunStatus, StepStatus } from '../../../server/db.ts';

export type Status = RunStatus | StepStatus;

export const STATUS_LABEL: Record<Status, string> = {
  pending: 'Waiting',
  running: 'Running',
  'awaiting-approval': 'Needs approval',
  succeeded: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
  interrupted: 'Interrupted',
  blocked: 'Not available yet',
  rejected: 'Rejected',
};

export type Tone = 'running' | 'success' | 'attention' | 'danger' | 'muted' | 'neutral';
export const STATUS_TONE: Record<Status, Tone> = {
  pending: 'neutral',
  running: 'running',
  'awaiting-approval': 'attention',
  succeeded: 'success',
  failed: 'danger',
  cancelled: 'muted',
  interrupted: 'danger',
  blocked: 'muted',
  rejected: 'danger',
};

export function duration(start: string | null, end: string | null): string {
  if (!start) return '';
  const ms = (end ? Date.parse(end) : Date.now()) - Date.parse(start);
  if (ms < 1000) return `${Math.max(ms, 0)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)} s`;
  return `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

export function ago(iso: string | null): string {
  if (!iso) return '';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export const bytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

export const sourceKindLabel = {
  github: 'Repository',
  website: 'Website',
  figma: 'Figma file',
  package: 'Package',
} as const;

/** Run-level wording where it differs from a step's. */
export const runLabel = (s: Status) => (s === 'blocked' ? 'Stopped: next stage not built' : STATUS_LABEL[s]);
