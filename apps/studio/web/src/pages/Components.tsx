import { useState } from 'react';
import { api, type ComponentCandidateView, type SavedSpec, type SpecFields } from '../lib/api.ts';
import { href, useLoad } from '../lib/hooks.ts';
import { EmptyState, ErrorNote, PageHeader } from '../components/ui.tsx';
import type { PageProps } from './types.ts';

/** The repetition note duplicates the count in the header, so it is not repeated as a warning. */
const notesFor = (x: ComponentCandidateView) => x.notes.filter((n) => !(x.onPage && n.startsWith('Repeated ')));

const lines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

/** The parts of a spec only a person can write. Saving keeps a draft; approving needs the first two. */
function SpecForm({ projectId, id }: { projectId: string; id: string }) {
  const saved = useLoad(() => api.savedSpec(projectId, id), [projectId, id]);
  const [f, setF] = useState<{ [K in keyof SpecFields]: string } | null>(null);
  const [state, setState] = useState<{ spec: SavedSpec | null; busy: boolean; error: string | null }>({
    spec: null,
    busy: false,
    error: null,
  });
  if (saved.error) return <ErrorNote>{saved.error}</ErrorNote>;
  if (!saved.data) return <div className="loading">Loading…</div>;
  const current = state.spec ?? saved.data.spec;
  const h = current?.human;
  const form = f ?? {
    summary: h?.summary ?? '',
    whenToUse: h?.whenToUse ?? '',
    dos: (h?.dos ?? []).join('\n'),
    donts: (h?.donts ?? []).join('\n'),
    keyboard: h?.keyboard ?? '',
    gapNotes: h?.gapNotes ?? '',
  };
  const set = (k: keyof SpecFields) => (e: { target: { value: string } }) => setF({ ...form, [k]: e.target.value });
  const save = async (approve: boolean) => {
    setState((s) => ({ ...s, busy: true, error: null }));
    try {
      const { spec } = await api.saveSpec(
        projectId,
        id,
        { ...form, dos: lines(form.dos), donts: lines(form.donts) },
        approve,
      );
      setState({ spec, busy: false, error: null });
    } catch (e) {
      setState((s) => ({ ...s, busy: false, error: e instanceof Error ? e.message : String(e) }));
    }
  };
  return (
    <form className="spec-form" onSubmit={(e) => e.preventDefault()}>
      <h3>
        Your part{' '}
        {current && (
          <span
            className={`status status--compact ${current.status === 'approved' ? 'status--success' : 'status--neutral'}`}
          >
            {current.status === 'approved' ? 'Approved' : 'Saved as draft'}
          </span>
        )}
      </h3>
      <label>
        One-line summary
        <input value={form.summary} onChange={set('summary')} maxLength={280} />
      </label>
      <label>
        When to use it
        <textarea rows={2} value={form.whenToUse} onChange={set('whenToUse')} />
      </label>
      <label>
        Do (one per line)
        <textarea rows={3} value={form.dos} onChange={set('dos')} />
      </label>
      <label>
        Don’t (one per line)
        <textarea rows={3} value={form.donts} onChange={set('donts')} />
      </label>
      <label>
        Keyboard behaviour
        <textarea rows={2} value={form.keyboard} onChange={set('keyboard')} />
      </label>
      <label>
        What to do about the gaps above
        <textarea rows={3} value={form.gapNotes} onChange={set('gapNotes')} />
      </label>
      {state.error && <ErrorNote>{state.error}</ErrorNote>}
      <div className="row">
        <button
          type="button"
          className="btn btn--secondary btn--md"
          disabled={state.busy}
          onClick={() => void save(false)}
        >
          Save draft
        </button>
        <button
          type="button"
          className="btn btn--primary btn--md"
          disabled={state.busy}
          onClick={() => void save(true)}
        >
          Approve spec
        </button>
      </div>
    </form>
  );
}

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
      <SpecForm projectId={projectId} id={id} />
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
