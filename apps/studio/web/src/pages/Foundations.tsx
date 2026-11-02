import { useState } from 'react';
import { api } from '../lib/api.ts';
import { href, useLoad } from '../lib/hooks.ts';
import { EmptyState, ErrorNote, PageHeader } from '../components/ui.tsx';
import type { PageProps } from './types.ts';

interface Row {
  name: string;
  from: string;
  type: string;
  value: string;
  detail: string;
}

export function FoundationsPage({ project, version }: PageProps) {
  const f = useLoad(() => api.foundations(project.id), [project.id, version]);
  const [type, setType] = useState('all');
  if (f.error)
    return (
      <div className="page">
        <ErrorNote>{f.error}</ErrorNote>
      </div>
    );
  if (!f.data) return <div className="loading">Loading…</div>;
  if (f.data.status === 'none') {
    return (
      <div className="page">
        <PageHeader title="Foundations" />
        <EmptyState
          icon="foundations"
          title="No tokens yet"
          action={
            <a className="btn btn--primary btn--md" href={href({ page: 'workflows', projectId: project.id })}>
              Open the workflow
            </a>
          }
        >
          Tokens appear here after a run extracts them from your source. Once you approve them, this page shows the
          built design tokens.
        </EmptyState>
      </div>
    );
  }
  const rows: Row[] =
    f.data.status === 'built'
      ? f.data.tokens.map((t) => ({
          name: t.name,
          from: t.provenance.source,
          type: t.type,
          value: t.css,
          detail:
            t.provenance.confidence === 'decided'
              ? `Decided (source had ${t.provenance.sourceValue ?? '?'})`
              : t.provenance.confidence,
        }))
      : f.data.proposals.map((p) => ({
          name: p.proposedName,
          from: p.cssVar,
          type: p.type,
          value: p.value,
          detail: p.promotable ? `Used ${p.usageCount}×` : `Not promotable: ${p.reason ?? ''}`,
        }));
  const types = [...new Set(rows.map((r) => r.type))].sort();
  const shown = rows.filter((r) => type === 'all' || r.type === type);

  return (
    <div className="page">
      <PageHeader
        title="Foundations"
        subtitle={
          f.data.status === 'built'
            ? `Version ${f.data.version} of the built tokens, from your approved review.`
            : 'Candidates from the latest extraction. They become tokens when you approve them in the review stage.'
        }
      />
      <div className="chips" role="tablist" aria-label="Token type">
        {['all', ...types].map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={type === t}
            className={`chip${type === t ? ' is-on' : ''}`}
            onClick={() => setType(t)}
          >
            {t === 'all' ? `All (${rows.length})` : `${t} (${rows.filter((r) => r.type === t).length})`}
          </button>
        ))}
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Token</th>
            <th>Value</th>
            <th>From</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.name + r.from}>
              <td>
                <code>{r.name}</code>
              </td>
              <td>
                <span className="token-value">
                  {r.type === 'color' && <span className="swatch" style={{ background: r.value }} aria-hidden="true" />}
                  <code>{r.value}</code>
                </span>
              </td>
              <td className="muted">
                <code>{r.from}</code>
              </td>
              <td className="muted">{r.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
