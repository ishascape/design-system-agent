/**
 * Schema for a canonical component spec (registry/components/<id>.json).
 *
 * The spec holds design decisions and links only. Behaviour lives in the React code, and the
 * prop API is extracted from the TypeScript source, so neither is duplicated here.
 */
import { z } from 'zod';
import { Confidence } from './audit.ts';

const FileLine = z.string().regex(/^[^:\s]+:\d+(-\d+)?$/, 'Use "path/to/file:line" or "file:start-end"');

export const ComponentSpec = z.object({
  $schema: z.string().optional(),
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  status: z.enum(['pending-approval', 'approved', 'deprecated']),
  summary: z.string().min(1).max(200),
  whenToUse: z.array(z.string()).min(1),
  whenNotToUse: z.array(z.string()),
  source: z.object({
    id: z.string(),
    commit: z.string().regex(/^[0-9a-f]{40}$/),
    styles: z.array(FileLine).min(1),
    usages: z.array(FileLine),
    rendered: z.string().optional(),
  }),
  variants: z.array(z.object({ name: z.string(), description: z.string(), confidence: Confidence })).min(1),
  states: z.array(
    z.object({
      name: z.enum(['default', 'hover', 'focus-visible', 'active', 'disabled', 'loading']),
      trigger: z.string(),
      visual: z.string(),
      confidence: Confidence,
    }),
  ),
  anatomy: z.array(z.object({ part: z.string(), description: z.string(), optional: z.boolean() })),
  /** Which canonical token styles which property. `name` must exist in the token manifest. */
  tokens: z.array(z.object({ name: z.string(), usedFor: z.string() })).min(1),
  /** Fixed values that are deliberately not tokens, with the reason. */
  constants: z.array(z.object({ name: z.string(), value: z.string(), reason: z.string() })),
  accessibility: z.object({
    elements: z.array(z.string()).min(1),
    keyboard: z.array(z.string()).min(1),
    notes: z.array(z.string()),
  }),
  guidelines: z.object({ do: z.array(z.string()).min(1), dont: z.array(z.string()).min(1) }),
  responsive: z.array(z.string()),
  code: z.object({
    package: z.string(),
    export: z.string(),
    file: z.string(),
    propsTypes: z.array(z.string()).min(1),
    css: z.string(),
    className: z.string(),
  }),
  figma: z
    .object({ file: z.string(), componentSet: z.string(), status: z.enum(['generated', 'not-generated', 'blocked']) })
    .optional(),
  docs: z.object({ storybook: z.string() }).optional(),
  openQuestions: z.array(z.string()),
});
export type ComponentSpec = z.infer<typeof ComponentSpec>;
