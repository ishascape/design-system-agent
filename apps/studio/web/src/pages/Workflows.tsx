import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
} from '@xyflow/react';
import { api } from '../lib/api.ts';
import { ago, duration, runLabel, sourceKindLabel } from '../lib/format.ts';
import { href, navigate, useLoad, useTicker } from '../lib/hooks.ts';
import { Button, ErrorNote, Icon, StatusBadge, sourceIcon } from '../components/ui.tsx';
import { StageNode, type StageNodeType } from './workflow/StageNode.tsx';
import { Inspector } from './workflow/Inspector.tsx';
import type { PageProps } from './types.ts';

const nodeTypes = { stage: StageNode };

/**
 * Canvas layout. Columns follow data dependencies (what each stage reads), not decoration;
 * the number on each stage is the order the engine runs them in.
 */
const LAYOUT: Record<string, [row: number, lane: number]> = {
  'import-source': [0, 0],
  discover: [1, 0],
  'extract-tokens': [2, -1],
  'identify-components': [2, 0],
  audit: [2, 1],
  review: [3, 0],
  'generate-code': [4, 0],
  'generate-figma': [5, -0.5],
  'generate-docs': [5, 0.5],
  validate: [6, 0],
};
const DEPENDS: [string, string][] = [
  ['import-source', 'discover'],
  ['discover', 'extract-tokens'],
  ['discover', 'identify-components'],
  ['discover', 'audit'],
  ['extract-tokens', 'review'],
  ['identify-components', 'review'],
  ['audit', 'review'],
  ['review', 'generate-code'],
  ['generate-code', 'generate-figma'],
  ['generate-code', 'generate-docs'],
  ['generate-figma', 'validate'],
  ['generate-docs', 'validate'],
];

export function WorkflowsPage(props: PageProps & { runId: string | undefined }) {
  return (
    <ReactFlowProvider>
      <Workflow {...props} />
    </ReactFlowProvider>
  );
}

/** Refits the canvas whenever it changes size (the inspector opening, a window resize). */
function useFitOnResize() {
  const { fitView } = useReactFlow();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => void fitView({ padding: 0.12, maxZoom: 1, duration: 160 }));
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [fitView]);
  return ref;
}

function Workflow({ project, version, workflow, runId }: PageProps & { runId: string | undefined }) {
  const selectedRunId = runId ?? project.activeRunId ?? project.runs[0]?.id;
  const run = useLoad(
    () => (selectedRunId ? api.run(project.id, selectedRunId) : Promise.resolve(undefined)),
    [project.id, selectedRunId, version],
  );
  const [selectedStep, setSelectedStep] = useState<string | null>(null);
  // Until you pick a stage yourself, the inspector follows the stage that is running or needs you.
  const [pinned, setPinned] = useState(false);
  const [sourceId, setSourceId] = useState(project.sources[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const r = run.data;
  const active = !!r && (r.status === 'running' || r.status === 'awaiting-approval');
  useTicker(r?.status === 'running');
  const canvasRef = useFitOnResize();

  useEffect(() => {
    if (!sourceId && project.sources[0]) setSourceId(project.sources[0].id);
  }, [project.sources, sourceId]);

  const focusKey = r?.steps.find(
    (s) => s.status === 'awaiting-approval' || s.status === 'running' || s.status === 'failed',
  )?.key;
  useEffect(() => {
    if (focusKey && !pinned) setSelectedStep(focusKey);
  }, [focusKey, pinned]);
  const resetFocus = () => {
    setSelectedStep(null);
    setPinned(false);
  };

  const nodes: StageNodeType[] = useMemo(
    () =>
      workflow.steps.map((def, i) => {
        const [row, lane] = LAYOUT[def.key] ?? [i, 0];
        return {
          id: def.key,
          type: 'stage',
          position: { x: lane * 270, y: row * 150 },
          data: { index: i, def, step: r?.steps.find((s) => s.key === def.key), selected: selectedStep === def.key },
          draggable: false,
          connectable: false,
        };
      }),
    [workflow.steps, r, selectedStep],
  );
  const edges: Edge[] = useMemo(
    () =>
      DEPENDS.map(([a, b]) => {
        const sa = r?.steps.find((s) => s.key === a)?.status;
        const sb = r?.steps.find((s) => s.key === b)?.status;
        const done = sa === 'succeeded';
        return {
          id: `${a}-${b}`,
          source: a,
          target: b,
          animated: done && sb === 'running',
          className: done ? 'edge--done' : '',
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
        };
      }),
    [r],
  );

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

  const start = () =>
    act(async () => {
      const created = await api.startRun(project.id, sourceId);
      resetFocus();
      navigate({ page: 'workflows', projectId: project.id, runId: created.id });
    });

  const step = r?.steps.find((s) => s.key === selectedStep);
  const def = workflow.steps.find((d) => d.key === selectedStep);

  return (
    <div className={`workspace${selectedStep ? ' has-inspector' : ''}`}>
      <div className="toolbar">
        <div className="toolbar__group">
          <h1 className="toolbar__title">{workflow.title}</h1>
          {project.runs.length > 0 && (
            <label className="select-wrap">
              <span className="visually-hidden">Run</span>
              <select
                className="select"
                value={selectedRunId}
                onChange={(e) => {
                  resetFocus();
                  navigate({ page: 'workflows', projectId: project.id, runId: e.target.value });
                }}
              >
                {project.runs.map((x) => (
                  <option key={x.id} value={x.id}>
                    Run {x.number} · {runLabel(x.status)} · {ago(x.createdAt)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {r && <StatusBadge status={r.status} run />}
          {r && (
            <span className="toolbar__meta">
              <Icon name={sourceIcon(r.source.kind)} size={14} />
              {r.source.label}
              <span className="dot-sep" aria-hidden="true" />
              {duration(r.createdAt, r.finishedAt)}
            </span>
          )}
        </div>
        <div className="toolbar__group">
          {active ? (
            <Button
              variant="danger"
              icon="stop"
              disabled={busy}
              onClick={() => act(() => api.cancelRun(project.id, r.id))}
            >
              Cancel run
            </Button>
          ) : project.sources.length ? (
            <>
              {project.sources.length > 1 && (
                <label className="select-wrap">
                  <span className="visually-hidden">Source</span>
                  <select className="select" value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
                    {project.sources.map((s) => (
                      <option key={s.id} value={s.id}>
                        {sourceKindLabel[s.kind]}: {s.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <Button
                variant="primary"
                icon="play"
                disabled={busy || !sourceId || !!project.activeRunId}
                onClick={start}
              >
                {project.runs.length ? 'Start new run' : 'Start run'}
              </Button>
            </>
          ) : (
            <a className="btn btn--primary btn--md" href={href({ page: 'settings', projectId: project.id })}>
              <Icon name="plus" />
              Add a source
            </a>
          )}
        </div>
      </div>
      {error && (
        <div className="workspace__error">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      <div className="canvas" aria-label="Workflow canvas" ref={canvasRef}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.12, maxZoom: 1 }}
          minZoom={0.3}
          maxZoom={1.5}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          onNodeClick={(_, n) => {
            setPinned(true);
            setSelectedStep(n.id);
          }}
          onPaneClick={() => {
            setPinned(true);
            setSelectedStep(null);
          }}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1.2} color="var(--ds-color-dot-grid)" />
          <Controls showInteractive={false} position="bottom-left" />
        </ReactFlow>
        {!r && (
          <div className="canvas__hint">
            {project.sources.length
              ? 'This is the workflow every run follows. Start a run to execute it on your source.'
              : 'Add a source in Settings, then start a run.'}
          </div>
        )}
      </div>
      {selectedStep && def && (
        <Inspector
          key={`${r?.id}-${def.key}`}
          project={project}
          run={r}
          def={def}
          step={step}
          version={version}
          onClose={() => {
            setPinned(true);
            setSelectedStep(null);
          }}
        />
      )}
    </div>
  );
}
