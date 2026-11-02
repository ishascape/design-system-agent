import { api, type Artifact } from '../lib/api.ts';
import { ago, bytes } from '../lib/format.ts';
import { useLoad } from '../lib/hooks.ts';
import { EmptyState, ErrorNote, Icon, PageHeader } from '../components/ui.tsx';
import type { PageProps } from './types.ts';

const LABEL: Record<string, string> = {
  inventory: 'Source inventory',
  'token-candidates': 'Token candidates (DTCG)',
  'components-report': 'Components report',
  'drift-report': 'Drift report',
  'token-map': 'Approved token map',
  'tokens-dtcg': 'Design tokens (DTCG JSON)',
  'tokens-css': 'Design tokens (CSS variables)',
  'tokens-manifest': 'Token manifest',
};

/** Every versioned file the workflow has produced. Older versions stay available. */
export function ExportsPage({ project, version }: PageProps) {
  const list = useLoad(() => api.artifacts(project.id), [project.id, version]);
  const groups = new Map<string, Artifact[]>();
  for (const a of list.data ?? []) groups.set(a.kind, [...(groups.get(a.kind) ?? []), a]);

  return (
    <div className="page">
      <PageHeader
        title="Exports"
        subtitle="Files the workflow produced. Each run adds a new version; older versions are kept."
      />
      {list.error && <ErrorNote>{list.error}</ErrorNote>}
      {list.data && list.data.length === 0 && (
        <EmptyState icon="exports" title="Nothing exported yet">
          Files appear here as the workflow runs.
        </EmptyState>
      )}
      {groups.size > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>File</th>
              <th>Latest</th>
              <th>Size</th>
              <th>Created</th>
              <th>
                <span className="visually-hidden">Download</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {[...groups.entries()].map(([kind, items]) => {
              const latest = items.reduce((a, b) => (b.version > a.version ? b : a));
              return (
                <tr key={kind}>
                  <td>
                    <div>{LABEL[kind] ?? kind}</div>
                    <div className="muted small">
                      <code>{latest.path.split('/').pop()}</code>
                      {items.length > 1 && ` · ${items.length} versions`}
                    </div>
                  </td>
                  <td>v{latest.version}</td>
                  <td className="muted">{bytes(latest.bytes)}</td>
                  <td className="muted">{ago(latest.createdAt)}</td>
                  <td>
                    <a className="btn btn--ghost btn--sm" href={api.artifactUrl(project.id, latest.id, true)}>
                      <Icon name="download" size={14} />
                      Download
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
