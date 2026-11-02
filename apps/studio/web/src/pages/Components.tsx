import { useState } from 'react';
import { api, type ComponentCandidateView } from '../lib/api.ts';
import { href, useLoad } from '../lib/hooks.ts';
import { EmptyState, ErrorNote, PageHeader } from '../components/ui.tsx';
import type { PageProps } from './types.ts';

/** The repetition note duplicates the count in the header, so it is not repeated as a warning. */
const notesFor = (x: ComponentCandidateView) => x.notes.filter((n) => !(x.onPage && n.startsWith('Repeated ')));

function SpecDraft({ projectId, id }: { projectId: string; id: string }) {
  const d = useLoad(() => api.specDraft(projectId, id), [projectId, id]);
  if (d.error) return <ErrorNote>{d.error}</ErrorNote>;
  if (!d.data) return <div className="loading">Drafting from the source…</div>;
  const { draft, tokensApproved } = d.data;
  return (
    <div className="spec-draft">
      <p className="muted small">
        A draft built only from the source CSS. Nothing here is approved yet.
        {!tokensApproved && ' Token names are not approved yet, so token use shows as gaps.'}
      </p>
      <dl className="facts">
        <div className="facts__row">
          <dt>Variants</dt>
          <dd>
            <ul className="plain">
              {draft.variants.map((v) => (
                <li key={v.name}>
                  <strong>{v.name}</strong>: {v.description}
                </li>
              ))}
            </ul>
          </dd>
        </div>
        <div className="facts__row">
          <dt>States</dt>
          <dd>
            <ul className="plain">
              {draft.states.map((s) => (
                <li key={s.name}>
                  <strong>{s.name}</strong> ({s.trigger}): {s.visual}
                </li>
              ))}
            </ul>
          </dd>
        </div>
        <div className="facts__row">
          <dt>Parts</dt>
          <dd>
            <ul className="plain">
              {draft.anatomy.map((a) => (
                <li key={a.part}>
                  <strong>{a.part}</strong>
                  {a.optional ? ' (optional)' : ''}: {a.description}
                </li>
              ))}
            </ul>
          </dd>
        </div>
        {draft.tokens.length > 0 && (
          <div className="facts__row">
            <dt>Tokens</dt>
            <dd>
              <ul className="plain">
                {draft.tokens.map((t) => (
                  <li key={t.name}>
                    <code>{t.name}</code>: {t.usedFor}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        )}
        {draft.hardCoded.length > 0 && (
          <div className="facts__row">
            <dt>Fixed values</dt>
            <dd>
              <ul className="plain">
                {draft.hardCoded.map((h) => (
                  <li key={`${h.at}-${h.property}`}>
                    <code>
                      {h.property}: {h.value}
                    </code>{' '}
                    <span className="muted small">{h.at}</span>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        )}
      </dl>
      <h3>Needs you</h3>
      <ul className="warnings">
        {draft.needsYou.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </div>
  );
}

export function ComponentsPage({ project, version }: PageProps) {
  const c = useLoad(() => api.components(project.id), [project.id, version]);
  const [open, setOpen] = useState<string | null>(null);
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
              <button
                type="button"
                className="btn btn--secondary btn--md"
                aria-expanded={open === x.id}
                onClick={() => setOpen(open === x.id ? null : x.id)}
              >
                {open === x.id ? 'Hide draft spec' : 'Draft a spec'}
              </button>
              {open === x.id && <SpecDraft projectId={project.id} id={x.id} />}
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
