import { useState } from 'react';
import { api } from '../lib/api.ts';
import { useLoad } from '../lib/hooks.ts';
import { EmptyState, ErrorNote, Icon, PageHeader } from '../components/ui.tsx';
import type { PageProps } from './types.ts';

const REPORTS: Record<string, string> = {
  'docs-site': 'Documentation site',
  'agent-catalog': 'Catalog for AI agents',
  'validation-report': 'Validation report',
  'components-report': 'Components report',
  'drift-report': 'Drift report',
};

/** The generated docs site (shown in a sandboxed frame) and the reports the workflow has written. */
export function DocumentationPage({ project, version }: PageProps) {
  const list = useLoad(() => api.artifacts(project.id), [project.id, version]);
  const [open, setOpen] = useState<string | null>(null);
  const openArt = list.data?.find((a) => a.id === open);
  const isSite = openArt?.kind === 'docs-site';
  const doc = useLoad(
    () => (open && !isSite ? api.artifactText(project.id, open) : Promise.resolve('')),
    [project.id, open, isSite],
  );
  const latest = Object.keys(REPORTS)
    .map((k) => list.data?.find((a) => a.kind === k))
    .filter((a) => !!a);

  return (
    <div className="page">
      <PageHeader
        title="Documentation"
        subtitle="The documentation site and reports from your latest runs. Each run adds a new version."
      />
      {list.error && <ErrorNote>{list.error}</ErrorNote>}
      {list.data && latest.length === 0 && (
        <EmptyState icon="docs" title="No documentation yet">
          Reports appear after a run finishes the Identify components and Audit stages. The documentation site appears
          once you approve tokens and the run builds them.
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
            {!open ? (
              <p className="muted">Choose a report.</p>
            ) : isSite ? (
              <>
                <div className="doc-actions">
                  <a
                    className="btn btn--secondary btn--sm"
                    href={api.docsUrl(project.id, open)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open in a new tab
                  </a>
                  <a className="btn btn--ghost btn--sm" href={api.artifactUrl(project.id, open, true)}>
                    Download HTML
                  </a>
                </div>
                <iframe
                  className="doc-frame"
                  title="Documentation site"
                  sandbox=""
                  src={api.docsUrl(project.id, open)}
                />
              </>
            ) : (
              <pre className="doc-text">{doc.data}</pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
