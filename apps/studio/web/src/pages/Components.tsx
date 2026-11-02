import { api, type ComponentCandidateView } from '../lib/api.ts';
import { href, useLoad } from '../lib/hooks.ts';
import { EmptyState, ErrorNote, PageHeader } from '../components/ui.tsx';
import type { PageProps } from './types.ts';

/** The repetition note duplicates the count in the header, so it is not repeated as a warning. */
const notesFor = (x: ComponentCandidateView) => x.notes.filter((n) => !(x.onPage && n.startsWith('Repeated ')));

export function ComponentsPage({ project, version }: PageProps) {
  const c = useLoad(() => api.components(project.id), [project.id, version]);
  if (c.error)
    return (
      <div className="page">
        <ErrorNote>{c.error}</ErrorNote>
      </div>
    );
  if (!c.data) return <div className="loading">Loading…</div>;
  return (
    <div className="page">
      <PageHeader
        title="Components"
        subtitle="Reusable components found in the source. Turning one into a tested component, its Figma twin and a docs page is the generation stage."
      />
      {c.data.status === 'none' ? (
        <EmptyState
          icon="components"
          title="No components found yet"
          action={
            <a className="btn btn--primary btn--md" href={href({ page: 'workflows', projectId: project.id })}>
              Open the workflow
            </a>
          }
        >
          Components appear after a run identifies them in your source.
        </EmptyState>
      ) : (
        <ul className="component-grid">
          {c.data.candidates.map((x) => (
            <li key={x.id} className="card component-card">
              <div className="component-card__head">
                <h2>{x.id}</h2>
                <span className="muted small">
                  {x.onPage
                    ? `${x.uses} times on the page`
                    : `${x.uses} uses in ${x.usedIn} ${x.usedIn === 1 ? 'file' : 'files'}`}
                </span>
              </div>
              <dl className="facts">
                {x.modifiers.length > 0 && (
                  <div className="facts__row">
                    <dt>Variants</dt>
                    <dd>{x.modifiers.join(', ')}</dd>
                  </div>
                )}
                {x.states.length > 0 && (
                  <div className="facts__row">
                    <dt>States</dt>
                    <dd>{x.states.join(', ')}</dd>
                  </div>
                )}
                {x.elements.length > 0 && (
                  <div className="facts__row">
                    <dt>Used on</dt>
                    <dd>
                      <code>{x.elements.map((e) => `<${e}>`).join(' ')}</code>
                    </dd>
                  </div>
                )}
                <div className="facts__row">
                  <dt>Styles</dt>
                  <dd>
                    <code>{x.styles.slice(0, 3).join(', ')}</code>
                    {x.styles.length > 3 && ` +${x.styles.length - 3}`}
                  </dd>
                </div>
              </dl>
              {notesFor(x).length > 0 && (
                <ul className="warnings">
                  {notesFor(x).map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
