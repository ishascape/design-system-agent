import { useMemo, useState } from 'react';
import {
  api,
  type ProjectDetail,
  type RunView,
  type Step,
  type TokenProposal,
  type WorkflowStepDef,
} from '../../lib/api.ts';
import { bytes, duration, sourceKindLabel } from '../../lib/format.ts';
import { useLoad } from '../../lib/hooks.ts';
import { COLLAPSE_OVER, groupTokens } from '../../lib/token-groups.ts';
import { Button, ErrorNote, Facts, Icon, StatusBadge, sourceIcon } from '../../components/ui.tsx';

type Tab = 'overview' | 'output' | 'logs' | 'artifacts';

export function Inspector({
  project,
  run,
  def,
  step,
  version,
  onClose,
}: {
  project: ProjectDetail;
  run: RunView | undefined;
  def: WorkflowStepDef;
  step: Step | undefined;
  version: number;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>('overview');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runActive = run?.status === 'running' || run?.status === 'awaiting-approval';
  const executing = step?.status === 'running';

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const retryable = step && ['failed', 'interrupted', 'cancelled', 'blocked', 'rejected'].includes(step.status);
  const rerunnable = step && step.status === 'succeeded';
  const otherStepRunning = run?.steps.some((s) => s.status === 'running');

  return (
    <aside className="inspector" aria-label={`${def.title} details`}>
      <header className="inspector__head">
        <div>
          <div className="inspector__eyebrow">Stage {run ? (step?.position ?? 0) + 1 : ''}</div>
          <h2>{def.title}</h2>
        </div>
        <button type="button" className="icon-btn" aria-label="Close details" onClick={onClose}>
          <Icon name="x" />
        </button>
      </header>
      <div className="inspector__status">
        <StatusBadge status={step?.status ?? 'pending'} />
        {step?.startedAt && (
          <span className="muted">
            <Icon name="clock" size={12} /> {duration(step.startedAt, step.finishedAt)}
          </span>
        )}
        {step && step.attempt > 1 && <span className="muted">Attempt {step.attempt}</span>}
        <span className="inspector__actions">
          {retryable && (
            <Button
              size="sm"
              icon="retry"
              disabled={busy || !!otherStepRunning}
              onClick={() => act(() => api.rerun(project.id, step.id))}
            >
              Retry
            </Button>
          )}
          {rerunnable && !runActive && (
            <Button
              size="sm"
              icon="retry"
              disabled={busy}
              onClick={() => act(() => api.rerun(project.id, step.id))}
              title="Runs this stage and every stage after it again"
            >
              Run again from here
            </Button>
          )}
        </span>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}

      {step?.status === 'awaiting-approval' && (
        <ApprovalPanel
          key={step.id}
          project={project}
          step={step}
          prompt={def.approvalPrompt}
          onAct={act}
          busy={busy}
        />
      )}

      <div className="tabs" role="tablist">
        {(['overview', 'output', 'logs', 'artifacts'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className={`tab${tab === t ? ' is-on' : ''}`}
            onClick={() => setTab(t)}
          >
            {t[0]!.toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      <div className="inspector__body" role="tabpanel">
        {tab === 'overview' && (
          <OverviewTab
            run={run}
            def={def}
            step={step}
            disabled={busy || !!runActive || !!executing}
            onRerun={(params) => act(() => api.rerun(project.id, step!.id, params))}
          />
        )}
        {tab === 'output' && <OutputTab step={step} />}
        {tab === 'logs' && <LogsTab project={project} step={step} version={version} />}
        {tab === 'artifacts' && <ArtifactsTab project={project} step={step} version={version} />}
      </div>
    </aside>
  );
}

function OverviewTab({
  run,
  def,
  step,
  disabled,
  onRerun,
}: {
  run: RunView | undefined;
  def: WorkflowStepDef;
  step: Step | undefined;
  disabled: boolean;
  onRerun: (params: Record<string, unknown>) => void;
}) {
  const paramKeys = Object.keys(def.params);
  const [params, setParams] = useState<Record<string, string>>(() =>
    Object.fromEntries(paramKeys.map((k) => [k, String((step?.params ?? def.params)[k] ?? '')])),
  );
  return (
    <div className="stack">
      <p className="muted">{def.description}</p>
      {step?.error && (
        <div className="note note--danger">
          <Icon name="alert" size={14} />
          <div>
            <strong>{step.status === 'blocked' ? 'Not available yet' : 'Error'}</strong>
            <div>{step.error}</div>
          </div>
        </div>
      )}
      {step?.summary && (
        <section className="panel">
          <h3>{step.summary.headline}</h3>
          <Facts facts={step.summary.facts} />
          {step.summary.warnings.length > 0 && (
            <ul className="warnings">
              {step.summary.warnings.slice(0, 12).map((w, i) => (
                <li key={i}>
                  <Icon name="alert" size={12} />
                  <span>{w}</span>
                </li>
              ))}
              {step.summary.warnings.length > 12 && (
                <li className="muted">and {step.summary.warnings.length - 12} more in the output</li>
              )}
            </ul>
          )}
        </section>
      )}
      {step?.decision && (
        <section className="panel">
          <h3>Decision</h3>
          <Facts
            facts={[
              { label: 'Decision', value: step.decision === 'approved' ? 'Approved' : 'Rejected' },
              ...(step.decisionNote ? [{ label: 'Note', value: step.decisionNote }] : []),
              ...(step.decidedAt ? [{ label: 'When', value: new Date(step.decidedAt).toLocaleString() }] : []),
            ]}
          />
        </section>
      )}
      {!step && <p className="muted">This stage has not run yet.</p>}
      {run && def.key === 'import-source' && (
        <section className="panel">
          <h3>Source</h3>
          <div className="source-line">
            <Icon name={sourceIcon(run.source.kind)} size={14} />
            <span>{sourceKindLabel[run.source.kind]}</span>
          </div>
          <code className="code-line">{run.source.url}</code>
        </section>
      )}
      {step && paramKeys.length > 0 && (
        <section className="panel">
          <h3>Inputs</h3>
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              onRerun(params);
            }}
          >
            {paramKeys.map((k) => (
              <label key={k} className="field">
                <span className="field__label">{k === 'ref' ? 'Branch, tag or commit' : k}</span>
                <input
                  className="input input--mono"
                  value={params[k] ?? ''}
                  onChange={(e) => setParams({ ...params, [k]: e.target.value })}
                />
              </label>
            ))}
            <div>
              <Button type="submit" size="sm" icon="retry" disabled={disabled}>
                Run again with these inputs
              </Button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}

function OutputTab({ step }: { step: Step | undefined }) {
  if (!step?.output) return <p className="muted">No output yet.</p>;
  return <pre className="json">{JSON.stringify(step.output, null, 2)}</pre>;
}

function LogsTab({ project, step, version }: { project: ProjectDetail; step: Step | undefined; version: number }) {
  const logs = useLoad(
    () => (step ? api.logs(project.id, step.id) : Promise.resolve([])),
    [project.id, step?.id, version],
  );
  if (!step) return <p className="muted">No logs yet.</p>;
  if (logs.error) return <ErrorNote>{logs.error}</ErrorNote>;
  if (!logs.data?.length) return <p className="muted">No log lines.</p>;
  return (
    <ol className="logs">
      {logs.data.map((l) => (
        <li key={l.id} className={`log log--${l.level}`}>
          <time>{new Date(l.ts).toLocaleTimeString()}</time>
          {l.attempt > 1 && <span className="log__attempt">#{l.attempt}</span>}
          <span className="log__msg">{l.message}</span>
        </li>
      ))}
    </ol>
  );
}

function ArtifactsTab({ project, step, version }: { project: ProjectDetail; step: Step | undefined; version: number }) {
  const list = useLoad(
    () => (step ? api.artifacts(project.id, { stepId: step.id }) : Promise.resolve([])),
    [project.id, step?.id, version],
  );
  const [open, setOpen] = useState<{ id: string; text: string; image: boolean } | null>(null);
  if (!step) return <p className="muted">No artifacts yet.</p>;
  if (list.error) return <ErrorNote>{list.error}</ErrorNote>;
  if (!list.data?.length) return <p className="muted">This stage saved no files.</p>;
  return (
    <div className="stack">
      <ul className="artifact-list">
        {list.data.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              className={`artifact${open?.id === a.id ? ' is-on' : ''}`}
              onClick={async () =>
                setOpen(
                  open?.id === a.id
                    ? null
                    : a.mediaType === 'image/png'
                      ? { id: a.id, text: '', image: true }
                      : { id: a.id, text: await api.artifactText(project.id, a.id), image: false },
                )
              }
            >
              <Icon name="file" size={14} />
              <span className="artifact__name">{a.path.split('/').pop()}</span>
              <span className="artifact__meta">
                {a.kind} · v{a.version} · {bytes(a.bytes)}
              </span>
            </button>
            <a
              className="icon-btn"
              href={api.artifactUrl(project.id, a.id, true)}
              aria-label={`Download ${a.path.split('/').pop()}`}
            >
              <Icon name="download" size={14} />
            </a>
          </li>
        ))}
      </ul>
      {open?.image && (
        <img className="shot" src={api.artifactUrl(project.id, open.id)} alt="Screenshot of the rendered page" />
      )}
      {open && !open.image && (
        <pre className="json json--file">
          {open.text.length > 200_000
            ? open.text.slice(0, 200_000) + '\n… (truncated; download for the full file)'
            : open.text}
        </pre>
      )}
    </div>
  );
}

/** Bare channels (`216 210 196`) are not a CSS colour by themselves; wrap them for the swatch. */
const swatchColor = (v: string) =>
  /^\d{1,3}(\s*,\s*|\s+)\d{1,3}(\s*,\s*|\s+)\d{1,3}$/.test(v.trim()) ? `rgb(${v})` : v;

/** The review gate: choose which tokens enter the design system and what they are called. */
function ApprovalPanel({
  project,
  step,
  prompt,
  onAct,
  busy,
}: {
  project: ProjectDetail;
  step: Step;
  prompt: string | null;
  onAct: (fn: () => Promise<unknown>) => void;
  busy: boolean;
}) {
  const out = step.output as { tokens?: TokenProposal[]; skipped?: TokenProposal[] } | null;
  const tokens = useMemo(() => out?.tokens ?? [], [out]);
  const skipped = out?.skipped ?? [];
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [names, setNames] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [filter, setFilter] = useState('');

  const finalName = (t: TokenProposal) => (names[t.cssVar] ?? t.proposedName).trim();
  const kept = tokens.filter((t) => !excluded.has(t.cssVar));
  const dupes = new Set(kept.map(finalName).filter((n, i, all) => all.indexOf(n) !== i));
  const invalid = kept.some((t) => !/^[a-z]+(\.[a-z0-9-]+)+$/.test(finalName(t)));
  const matches = (t: TokenProposal) => !filter || t.cssVar.includes(filter) || finalName(t).includes(filter);
  const groups = useMemo(() => groupTokens(tokens), [tokens]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const setGroup = (items: TokenProposal[], keep: boolean) => {
    const next = new Set(excluded);
    for (const t of items) {
      if (keep) next.delete(t.cssVar);
      else next.add(t.cssVar);
    }
    setExcluded(next);
  };

  const approve = () => {
    const rename: Record<string, string> = {};
    for (const t of kept) if (finalName(t) !== t.proposedName) rename[t.cssVar] = finalName(t);
    onAct(() => api.approve(project.id, step.id, { exclude: [...excluded], rename }, note.trim() || null));
  };

  return (
    <section className="approval" aria-label="Approval needed">
      <div className="approval__head">
        <Icon name="pause" size={14} />
        <div>
          <strong>{prompt ?? 'Your approval is needed'}</strong>
          <div className="muted">
            {kept.length} of {tokens.length} tokens will be kept. Nothing is written until you approve.
          </div>
        </div>
      </div>
      {tokens.length > 0 && (
        <>
          <input
            className="input input--sm"
            placeholder="Filter tokens"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filter tokens"
          />
          <div className="token-table" role="table" aria-label="Proposed tokens">
            <div className="token-table__row token-table__row--head" role="row">
              <span role="columnheader">Keep</span>
              <span role="columnheader">From</span>
              <span role="columnheader">Name in the design system</span>
            </div>
            {groups.map((g) => {
              const items = g.items.filter(matches);
              if (!items.length) return null;
              const keptCount = g.items.filter((t) => !excluded.has(t.cssVar)).length;
              const open = !!filter || (expanded[g.key] ?? g.items.length <= COLLAPSE_OVER);
              return (
                <div key={g.key} role="rowgroup" className="token-group">
                  <div className="token-table__row token-group__head" role="row">
                    <span role="cell">
                      <input
                        type="checkbox"
                        checked={keptCount === g.items.length}
                        ref={(el) => {
                          if (el) el.indeterminate = keptCount > 0 && keptCount < g.items.length;
                        }}
                        aria-label={`Keep all ${g.label}`}
                        onChange={() => setGroup(g.items, keptCount < g.items.length)}
                      />
                    </span>
                    <button
                      type="button"
                      className="token-group__toggle"
                      aria-expanded={open}
                      onClick={() => setExpanded({ ...expanded, [g.key]: !open })}
                    >
                      <Icon name="chevron" size={12} className={open ? 'is-open' : ''} />
                      <span>{g.label}</span>
                      <span className="muted">
                        {keptCount} of {g.items.length} kept
                      </span>
                    </button>
                  </div>
                  {open &&
                    items.map((t) => {
                      const on = !excluded.has(t.cssVar);
                      const name = finalName(t);
                      return (
                        <div key={t.cssVar} className={`token-table__row${on ? '' : ' is-off'}`} role="row">
                          <span role="cell">
                            <input
                              type="checkbox"
                              checked={on}
                              aria-label={`Keep ${t.cssVar}`}
                              onChange={() => setGroup([t], !on)}
                            />
                          </span>
                          <span role="cell" className="token-from">
                            {t.type === 'color' && (
                              <span
                                className="swatch"
                                style={{ background: swatchColor(t.value) }}
                                aria-hidden="true"
                              />
                            )}
                            <code title={`${t.value} · used ${t.usageCount}×`}>{t.cssVar}</code>
                          </span>
                          <span role="cell">
                            <input
                              className={`input input--sm input--mono${on && dupes.has(name) ? ' is-invalid' : ''}`}
                              value={names[t.cssVar] ?? t.proposedName}
                              disabled={!on}
                              aria-label={`Name for ${t.cssVar}`}
                              onChange={(e) => setNames({ ...names, [t.cssVar]: e.target.value })}
                            />
                          </span>
                        </div>
                      );
                    })}
                </div>
              );
            })}
          </div>
        </>
      )}
      {skipped.length > 0 && (
        <details className="skipped">
          <summary>
            {skipped.length} {skipped.length === 1 ? 'custom property is' : 'custom properties are'} left out of review,
            with the reason
          </summary>
          <ul className="skipped__list" aria-label="Left out of review">
            {skipped.map((t) => (
              <li key={t.cssVar}>
                <code title={`${t.source} · used ${t.usageCount}×`}>{t.cssVar}</code>
                <span className="muted">{t.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {dupes.size > 0 && <ErrorNote>Two kept tokens share a name: {[...dupes].join(', ')}</ErrorNote>}
      {invalid && (
        <ErrorNote>Names are dot paths that start with a lowercase word, like color.ink or space.4.</ErrorNote>
      )}
      <textarea
        className="input"
        rows={2}
        placeholder="Note for the change history (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        aria-label="Decision note"
      />
      <div className="approval__actions">
        <Button
          variant="ghost"
          icon="x"
          disabled={busy}
          onClick={() => onAct(() => api.reject(project.id, step.id, note.trim() || null))}
        >
          Reject
        </Button>
        <Button
          variant="primary"
          icon="check"
          disabled={busy || dupes.size > 0 || invalid || kept.length === 0}
          onClick={approve}
        >
          Approve {kept.length} tokens
        </Button>
      </div>
    </section>
  );
}
