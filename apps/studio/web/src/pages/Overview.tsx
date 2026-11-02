import { api } from '../lib/api.ts';
import { ago, sourceKindLabel } from '../lib/format.ts';
import { href, useLoad } from '../lib/hooks.ts';
import { EmptyState, Icon, PageHeader, StatusBadge, sourceIcon } from '../components/ui.tsx';
import type { PageProps } from './types.ts';

export function OverviewPage({ project, version, workflow }: PageProps) {
  const latest = project.runs[0];
  const run = useLoad(
    () => (latest ? api.run(project.id, latest.id) : Promise.resolve(undefined)),
    [project.id, latest?.id, version],
  );
  const foundations = useLoad(() => api.foundations(project.id), [project.id, version]);
  const components = useLoad(() => api.components(project.id), [project.id, version]);
  const shots = useLoad(() => api.artifacts(project.id), [project.id, version]);
  const shot = shots.data?.find((a) => a.kind === 'screenshot');
  const waiting = run.data?.steps.find((s) => s.status === 'awaiting-approval');
  const failed = run.data?.steps.find((s) => s.status === 'failed' || s.status === 'interrupted');

  const tokenCount =
    foundations.data?.status === 'built'
      ? foundations.data.tokens.length
      : foundations.data?.status === 'candidates'
        ? foundations.data.proposals.length
        : 0;
  const componentCount = components.data?.status === 'candidates' ? components.data.candidates.length : 0;

  return (
    <div className="page">
      <PageHeader title={project.name} subtitle={project.description || `Created ${ago(project.createdAt)}`} />

      {waiting && (
        <a
          className="callout callout--attention"
          href={href({ page: 'workflows', projectId: project.id, runId: latest!.id })}
        >
          <Icon name="pause" />
          <div>
            <strong>Run {latest!.number} is waiting for your review</strong>
            <span>{workflow.steps.find((d) => d.key === waiting.key)?.approvalPrompt}</span>
          </div>
          <Icon name="chevron" />
        </a>
      )}
      {failed && !waiting && (
        <a
          className="callout callout--danger"
          href={href({ page: 'workflows', projectId: project.id, runId: latest!.id })}
        >
          <Icon name="alert" />
          <div>
            <strong>
              {workflow.steps.find((d) => d.key === failed.key)?.title} failed in run {latest!.number}
            </strong>
            <span>{failed.error}</span>
          </div>
          <Icon name="chevron" />
        </a>
      )}

      <div className="stats">
        <a className="stat" href={href({ page: 'foundations', projectId: project.id })}>
          <span className="stat__value">{tokenCount}</span>
          <span className="stat__label">
            {foundations.data?.status === 'built' ? 'Tokens built' : 'Token candidates'}
          </span>
        </a>
        <a className="stat" href={href({ page: 'components', projectId: project.id })}>
          <span className="stat__value">{componentCount}</span>
          <span className="stat__label">Component candidates</span>
        </a>
        <a className="stat" href={href({ page: 'workflows', projectId: project.id })}>
          <span className="stat__value">{project.runs.length}</span>
          <span className="stat__label">Runs</span>
        </a>
        <a className="stat" href={href({ page: 'exports', projectId: project.id })}>
          <span className="stat__value">{project.artifactCount}</span>
          <span className="stat__label">Saved files</span>
        </a>
      </div>

      <div className="two-col">
        <section className="card">
          <h2 className="card__title">Latest run</h2>
          {!latest && (
            <EmptyState
              icon="workflows"
              title="No runs yet"
              action={
                <a className="btn btn--primary btn--md" href={href({ page: 'workflows', projectId: project.id })}>
                  Open the workflow
                </a>
              }
            >
              A run imports the source, extracts tokens and components, and stops for your review.
            </EmptyState>
          )}
          {latest && run.data && (
            <>
              <div className="run-head">
                <a href={href({ page: 'workflows', projectId: project.id, runId: latest.id })}>Run {latest.number}</a>
                <StatusBadge status={latest.status} run />
                <span className="muted">{ago(latest.createdAt)}</span>
              </div>
              <ol className="progress-list">
                {workflow.steps.map((d) => {
                  const s = run.data!.steps.find((x) => x.key === d.key);
                  return (
                    <li key={d.key}>
                      <StatusBadge status={s?.status ?? 'pending'} compact />
                      <span className="progress-list__title">{d.title}</span>
                      <span className="progress-list__detail">{s?.summary?.headline ?? s?.error ?? ''}</span>
                    </li>
                  );
                })}
              </ol>
            </>
          )}
        </section>
        <section className="card">
          <h2 className="card__title">Sources</h2>
          {shot && (
            <img className="shot" src={api.artifactUrl(project.id, shot.id)} alt="Screenshot of the source website" />
          )}
          {project.sources.length === 0 ? (
            <p className="muted">
              No source yet. <a href={href({ page: 'settings', projectId: project.id })}>Add one in Settings.</a>
            </p>
          ) : (
            <ul className="source-list">
              {project.sources.map((s) => (
                <li key={s.id}>
                  <Icon name={sourceIcon(s.kind)} />
                  <div>
                    <div>{s.label}</div>
                    <div className="muted small">
                      {sourceKindLabel[s.kind]} · added {ago(s.createdAt)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
