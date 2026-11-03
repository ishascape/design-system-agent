import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { Step, WorkflowStepDef } from '../../lib/api.ts';
import { duration } from '../../lib/format.ts';
import { Icon, StatusBadge } from '../../components/ui.tsx';

export interface StageData extends Record<string, unknown> {
  index: number;
  def: WorkflowStepDef;
  step: Step | undefined;
  selected: boolean;
}
export type StageNodeType = Node<StageData, 'stage'>;

/** One workflow stage on the canvas. Everything shown comes from the persisted step record. */
export function StageNode({ data }: NodeProps<StageNodeType>) {
  const { index, def, step, selected } = data;
  const status = step?.status ?? 'pending';
  const warnings = step?.summary?.warnings.length ?? 0;
  const line =
    status === 'running'
      ? def.action
      : status === 'awaiting-approval'
        ? (def.approvalPrompt ?? 'Waiting for your decision')
        : step?.error
          ? step.error
          : (step?.summary?.headline ?? def.description);
  return (
    <div className={`stage stage--${status}${selected ? ' is-selected' : ''}`} data-testid={`stage-${def.key}`}>
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <div className="stage__top">
        <span className="stage__index">{index + 1}</span>
        <span className="stage__title">{def.title}</span>
        {def.requiresApproval && (
          <span className="stage__gate" title="Pauses for your approval">
            <Icon name="pause" size={12} />
          </span>
        )}
      </div>
      <p className={`stage__line${step?.error ? ' stage__line--error' : ''}`}>{line}</p>
      <div className="stage__foot">
        <StatusBadge status={status} compact />
        <span className="stage__meta">
          {warnings > 0 && (
            <span className="stage__warn" title={`${warnings} warnings`}>
              <Icon name="alert" size={12} />
              {warnings}
            </span>
          )}
          {step?.attempt && step.attempt > 1 ? <span title="Attempt">#{step.attempt}</span> : null}
          {step?.startedAt && <span>{duration(step.startedAt, step.finishedAt)}</span>}
        </span>
      </div>
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  );
}
