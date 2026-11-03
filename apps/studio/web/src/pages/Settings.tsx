import { useState, type FormEvent } from 'react';
import { api, type Source } from '../lib/api.ts';
import { ago, sourceKindLabel } from '../lib/format.ts';
import { navigate } from '../lib/hooks.ts';
import { Button, Dialog, ErrorNote, Field, Icon, PageHeader, sourceIcon } from '../components/ui.tsx';
import type { PageProps } from './types.ts';

export function SettingsPage({ project }: PageProps) {
  return (
    <div className="page page--narrow">
      <PageHeader title="Settings" />
      <DetailsForm key={project.updatedAt} id={project.id} name={project.name} description={project.description} />
      <Sources projectId={project.id} sources={project.sources} />
      <DangerZone id={project.id} name={project.name} running={!!project.activeRunId} />
    </div>
  );
}

function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await fn();
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, done, run };
}

function DetailsForm({ id, name: n0, description: d0 }: { id: string; name: string; description: string }) {
  const [name, setName] = useState(n0);
  const [description, setDescription] = useState(d0);
  const a = useAction();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void a.run(() => api.updateProject(id, { name: name.trim(), description: description.trim() }));
  };
  return (
    <section className="card">
      <h2 className="card__title">Project</h2>
      <form className="form" onSubmit={submit}>
        <Field label="Name">
          {(fid) => (
            <input
              id={fid}
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={80}
            />
          )}
        </Field>
        <Field label="Description">
          {(fid) => (
            <input
              id={fid}
              className="input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={300}
            />
          )}
        </Field>
        {a.error && <ErrorNote>{a.error}</ErrorNote>}
        <div className="form__actions">
          <Button
            type="submit"
            variant="primary"
            disabled={a.busy || !name.trim() || (name === n0 && description === d0)}
          >
            Save
          </Button>
        </div>
      </form>
    </section>
  );
}

function Sources({ projectId, sources }: { projectId: string; sources: Source[] }) {
  const [kind, setKind] = useState<Source['kind']>('website');
  const [url, setUrl] = useState('');
  const a = useAction();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void a.run(async () => {
      await api.addSource(projectId, { kind, url: url.trim() });
      setUrl('');
    });
  };
  return (
    <section className="card">
      <h2 className="card__title">Sources</h2>
      <p className="muted">
        The Studio only reads sources. It never pushes to a repository, changes a website or writes to a Figma file.
      </p>
      {sources.length > 0 && (
        <ul className="source-list">
          {sources.map((s) => (
            <li key={s.id}>
              <Icon name={sourceIcon(s.kind)} />
              <div>
                <div>{s.label}</div>
                <div className="muted small">
                  {sourceKindLabel[s.kind]} · <code>{s.url}</code> · added {ago(s.createdAt)}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <form className="form form--inline" onSubmit={submit}>
        <label className="select-wrap">
          <span className="visually-hidden">Source type</span>
          <select className="select" value={kind} onChange={(e) => setKind(e.target.value as Source['kind'])}>
            {(Object.keys(sourceKindLabel) as Source['kind'][]).map((k) => (
              <option key={k} value={k}>
                {sourceKindLabel[k]}
              </option>
            ))}
          </select>
        </label>
        <input
          className="input input--mono"
          type="url"
          placeholder="https://"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          aria-label="Source link"
          required
        />
        <Button type="submit" icon="plus" disabled={a.busy || !url.trim()}>
          Add source
        </Button>
      </form>
      {a.error && <ErrorNote>{a.error}</ErrorNote>}
    </section>
  );
}

function DangerZone({ id, name, running }: { id: string; name: string; running: boolean }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const a = useAction();
  return (
    <section className="card card--danger">
      <h2 className="card__title">Delete project</h2>
      <p className="muted">
        Deletes this project's runs, imported copies and generated files from this computer. Your sources are not
        touched.
      </p>
      <Button
        variant="danger"
        onClick={() => setOpen(true)}
        disabled={running}
        title={running ? 'Cancel the run in progress first' : undefined}
      >
        Delete project…
      </Button>
      <Dialog
        open={open}
        title={`Delete ${name}?`}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Keep project
            </Button>
            <Button
              variant="danger"
              disabled={a.busy || confirm !== name}
              onClick={() =>
                a.run(async () => {
                  await api.deleteProject(id, confirm);
                  navigate({ page: 'projects' });
                })
              }
            >
              Delete permanently
            </Button>
          </>
        }
      >
        <div className="form">
          <p>This cannot be undone. Type the project name to confirm.</p>
          <Field label={`Type “${name}”`}>
            {(fid) => (
              <input
                id={fid}
                className="input"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="off"
              />
            )}
          </Field>
          {a.error && <ErrorNote>{a.error}</ErrorNote>}
        </div>
      </Dialog>
    </section>
  );
}
