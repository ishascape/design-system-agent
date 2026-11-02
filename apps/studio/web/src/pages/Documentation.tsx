import { useState } from 'react';
import { api } from '../lib/api.ts';
import { useLoad } from '../lib/hooks.ts';
import { EmptyState, ErrorNote, Icon, PageHeader } from '../components/ui.tsx';
import type { PageProps } from './types.ts';

const REPORTS: Record<string, string> = {
  'components-report': 'Components report',
  'drift-report': 'Drift report',
};

/**
 * Reports the workflow has written so far. The generated documentation site is milestone 4; until
 * then this page says so rather than showing placeholder pages.
 */
export function DocumentationPage({ project, version }: PageProps) {
  const list = useLoad(() => api.artifacts(project.id), [project.id, version]);
  const [open, setOpen] = useState<string | null>(null);
  const doc = useLoad(() => (open ? api.artifactText(project.id, open) : Promise.resolve('')), [project.id, open]);
  const latest = Object.keys(REPORTS)
    .map((k) => list.data?.find((a) => a.kind === k))
    .filter((a) => !!a);

  return (
    <div className="page">
      <PageHeader
        title="Documentation"
        subtitle="Reports from your latest runs. The generated documentation site is part of the generation stage, which is not built yet."
      />
      {list.error && <ErrorNote>{list.error}</ErrorNote>}
      {list.data && latest.length === 0 && (
        <EmptyState icon="docs" title="No documentation yet">
          The components and drift reports appear here after a run finishes the Identify components and Audit stages.
        </EmptyState>
      )}
      {latest.length > 0 && (
        <div className="doc-layout">
          <ul className="doc-nav">
            {latest.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  className={`nav-item${open === a.id ? ' is-active' : ''}`}
                  onClick={() => setOpen(a.id)}
                >
                  <Icon name="docs" />
                  <span>
                    {REPORTS[a.kind]} <span className="muted">v{a.version}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="doc-body">
            {open ? <pre className="doc-text">{doc.data}</pre> : <p className="muted">Choose a report.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
