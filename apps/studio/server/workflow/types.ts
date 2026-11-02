/**
 * Typed workflow contracts. A workflow is a fixed, ordered list of steps. Each step declares its
 * parameters (validated with zod), whether it pauses for human approval, and a run function that
 * receives only what it needs: the project, the source, earlier step outputs, a logger, an abort
 * signal and an artifact writer.
 */
import type { z } from 'zod';
import type { Artifact, Project, Source, StepSummary } from '../db.ts';

export interface StepContext {
  project: Project;
  source: Source;
  runId: string;
  stepId: string;
  attempt: number;
  params: Record<string, unknown>;
  /** Outputs of earlier steps in this run, by step key. */
  outputs: Record<string, unknown>;
  /** The project's private working folder. */
  workspace: string;
  signal: AbortSignal;
  log: (message: string, level?: 'info' | 'warn' | 'error') => void;
  /** Writes a new version of an artifact for this project and records it. */
  saveArtifact: (kind: string, fileName: string, content: string | Buffer, mediaType: string) => Artifact;
}

export interface StepResult {
  summary: StepSummary;
  output: unknown;
}

export interface ApprovalContext extends StepContext {
  /** The output the step produced before pausing. */
  pending: unknown;
  /** Whatever the reviewer sent with the decision, validated by the step. */
  decision: unknown;
}

export interface StepDefinition {
  key: string;
  title: string;
  description: string;
  /** Short verb phrase shown while the step runs. */
  action: string;
  params?: z.ZodType<Record<string, unknown>>;
  /** If set, the step pauses after running until a person approves or rejects its proposal. */
  approval?: {
    prompt: string;
    /** Runs on approval; its result becomes the step's final result. */
    onApprove: (ctx: ApprovalContext) => Promise<StepResult> | StepResult;
  };
  run: (ctx: StepContext) => Promise<StepResult> | StepResult;
}

/** Thrown by a step that cannot run yet for a known reason (not a failure of the run itself). */
export class StepBlocked extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StepBlocked';
  }
}

export interface WorkflowDefinition {
  id: string;
  title: string;
  steps: StepDefinition[];
}
