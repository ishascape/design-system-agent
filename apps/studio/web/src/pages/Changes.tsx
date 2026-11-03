import { api, type RunView } from '../lib/api.ts';
import { ago } from '../lib/format.ts';
import { href, useLoad } from '../lib/hooks.ts';
import { EmptyState, ErrorNote, Icon, PageHeader, StatusBadge } from '../components/ui.tsx';
import type { PageProps } from './types.ts';

/** History of runs and the decisions made in them, newest first. */
export function ChangesPage({ project, version, workflow }: PageProps) {
  const runs = useLoad(
    () => Promise.all(project.runs.slice(0, 30).map((r) => api.run(project.id, r.id))),
    [project.id, project.runs.length, version],
  );
  const title = (key: string) => workflow.steps.find((d) => d.key === key)?.title ?? key;

  return (
    <div className="page">
      <PageHeader title="Changes" subtitle="Every run and every decision you made, newest first." />
      {runs.error && <ErrorNote>{runs.error}</ErrorNote>}
      {runs.data && runs.data.length === 0 && (
        <EmptyState icon="changes" title="No changes yet">
          Runs and approvals will be recorded here.
        </EmptyState>
      )}
      {runs.data && runs.data.length > 0 && (
        <ol className="timeline">
          {runs.data.map((r: RunView) => {
            const decisions = r.steps.filter((s) => s.decision);
            const failed = r.steps.filter((s) => s.status === 'failed');
            return (
              <li key={r.id} className="timeline__item">
                <div className="timeline__dot" aria-hidden="true" />
                <div className="timeline__body">
                  <div className="run-head">
                    <a href={href({ page: 'workflows', projectId: project.id, runId: r.id })}>Run {r.number}</a>
                    <StatusBadge status={r.status} compact run />
                    <span className="muted small">
                      {r.source.label} · {ago(r.createdAt)}
                    </span>
                  </div>
                  {decisions.map((s) => (
                    <div key={s.id} className="timeline__event">
                      <Icon name={s.decision === 'approved' ? 'check' : 'x'} size={14} />
                      <span>
                        {s.decision === 'approved' ? 'Approved' : 'Rejected'} <strong>{title(s.key)}</strong>
                        {s.summary?.headline ? `: ${s.summary.headline}` : ''}
                        {s.decisionNote ? ` · “${s.decisionNote}”` : ''}
                      </span>
                      <span className="muted small">{ago(s.decidedAt)}</span>
                    </div>
                  ))}
                  {failed.map((s) => (
                    <div key={s.id} className="timeline__event timeline__event--danger">
                      <Icon name="alert" size={14} />
                      <span>
                        <strong>{title(s.key)}</strong> failed: {s.error}
                      </span>
                    </div>
                  ))}
                  {!decisions.length && !failed.length && <div className="muted small">No decisions in this run.</div>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
