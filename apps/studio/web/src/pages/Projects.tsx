import { useState, type FormEvent } from 'react';
import { api, type Source } from '../lib/api.ts';
import { ago, sourceKindLabel } from '../lib/format.ts';
import { href, navigate, useLoad } from '../lib/hooks.ts';
import {
  Button,
  Dialog,
  EmptyState,
  ErrorNote,
  Field,
  Icon,
  PageHeader,
  StatusBadge,
  sourceIcon,
} from '../components/ui.tsx';

export function ProjectsPage() {
  const projects = useLoad(() => api.projects(), []);
  const [creating, setCreating] = useState(false);

  return (
    <div className="page">
      <PageHeader
        title="Projects"
        subtitle="Each project keeps its own sources, runs, tokens and outputs."
        actions={
          <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
            New project
          </Button>
        }
      />
      {projects.error && <ErrorNote>{projects.error}</ErrorNote>}
      {projects.data && projects.data.length === 0 && (
        <EmptyState
          icon="projects"
          title="No projects yet"
          action={
            <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
              Create your first project
            </Button>
          }
        >
          A project starts from a website, a GitHub repository, a Figma file or a design-system package. The Studio then
          extracts tokens and components for you to review.
        </EmptyState>
      )}
      {projects.data && projects.data.length > 0 && (
        <ul className="project-grid">
          {projects.data.map((p) => (
            <li key={p.id}>
              <a className="project-card" href={href({ page: 'overview', projectId: p.id })}>
                <div className="project-card__head">
                  <h2>{p.name}</h2>
                  {p.lastRun && <StatusBadge status={p.lastRun.status} compact run />}
                </div>
                {p.description && <p className="project-card__desc">{p.description}</p>}
                <ul className="project-card__sources">
                  {p.sources.slice(0, 3).map((s) => (
                    <li key={s.id}>
                      <Icon name={sourceIcon(s.kind)} size={14} />
                      <span>{s.label}</span>
                    </li>
                  ))}
                  {p.sources.length === 0 && <li className="muted">No source yet</li>}
                </ul>
                <div className="project-card__foot">
                  <span>
                    {p.runCount} {p.runCount === 1 ? 'run' : 'runs'}
                  </span>
                  <span>Updated {ago(p.updatedAt)}</span>
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}
      <NewProjectDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

const KINDS: { kind: Source['kind']; hint: string; placeholder: string }[] = [
  {
    kind: 'website',
    hint: 'The Studio downloads the page and its stylesheets. Nothing on the site is changed.',
    placeholder: 'https://example.com',
  },
  {
    kind: 'github',
    hint: 'A public HTTPS repository. The Studio makes a pinned, read-only copy.',
    placeholder: 'https://github.com/owner/repo',
  },
  {
    kind: 'figma',
    hint: 'Figma import is not available yet. You can add the link now and run it when it is.',
    placeholder: 'https://www.figma.com/design/…',
  },
  { kind: 'package', hint: 'Package import is not available yet.', placeholder: 'https://www.npmjs.com/package/…' },
];

function NewProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<Source['kind']>('website');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const k = KINDS.find((x) => x.kind === kind)!;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const p = await api.createProject({
        name: name.trim(),
        description: description.trim(),
        ...(url.trim() ? { source: { kind, url: url.trim() } } : {}),
      });
      onClose();
      navigate({ page: 'workflows', projectId: p.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      title="New project"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="new-project" disabled={busy || !name.trim()}>
            {busy ? 'Creating…' : 'Create project'}
          </Button>
        </>
      }
    >
      <form id="new-project" className="form" onSubmit={submit}>
        <Field label="Name">
          {(id) => (
            <input
              id={id}
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Portfolio"
              required
              autoFocus
              maxLength={80}
            />
          )}
        </Field>
        <Field label="Description (optional)">
          {(id) => (
            <input
              id={id}
              className="input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={300}
            />
          )}
        </Field>
        <fieldset className="field">
          <legend className="field__label">Source</legend>
          <div className="segmented" role="radiogroup" aria-label="Source type">
            {KINDS.map((x) => (
              <label key={x.kind} className={`segmented__opt${kind === x.kind ? ' is-on' : ''}`}>
                <input
                  type="radio"
                  name="kind"
                  value={x.kind}
                  checked={kind === x.kind}
                  onChange={() => setKind(x.kind)}
                />
                <Icon name={sourceIcon(x.kind)} size={14} />
                {sourceKindLabel[x.kind]}
              </label>
            ))}
          </div>
        </fieldset>
        <Field label="Link (optional, you can add it later)" hint={k.hint}>
          {(id) => (
            <input
              id={id}
              className="input input--mono"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={k.placeholder}
            />
          )}
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
      </form>
    </Dialog>
  );
}
