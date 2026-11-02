import type { ProjectDetail, WorkflowDef } from '../lib/api.ts';

export interface PageProps {
  project: ProjectDetail;
  /** Increments on every server change for this project; pass to useLoad to refetch. */
  version: number;
  workflow: WorkflowDef;
}
