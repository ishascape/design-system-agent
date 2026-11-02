/**
 * Schemas for audit output: what discovery found in a source, with evidence.
 *
 * Every value carries a source reference and a confidence level:
 * - observed: read directly from the source (a declaration, a usage)
 * - inferred: derived by a rule from observed data (e.g. "this px value is close to a token")
 * - proposed: a new decision that does not exist in the source yet
 *
 * Audit files are validated against these schemas before they are written,
 * so a bug in discovery fails loudly instead of producing a plausible-looking audit.
 */
import { z } from 'zod';

export const AUDIT_SCHEMA_VERSION = 1 as const;

/**
 * observed: read directly from the source. inferred: derived by a rule. proposed: suggested by
 * the agent, not yet approved. decided: a design decision by the owner, recorded with a reason.
 */
export const Confidence = z.enum(['observed', 'inferred', 'proposed', 'decided']);
export type Confidence = z.infer<typeof Confidence>;

export const SourceRef = z.object({
  /** Path relative to the source repository root, always with forward slashes. */
  file: z.string().min(1),
  line: z.number().int().positive(),
});
export type SourceRef = z.infer<typeof SourceRef>;

export const TokenType = z.enum(['color', 'dimension', 'fontFamily', 'duration', 'cubicBezier', 'number', 'other']);
export type TokenType = z.infer<typeof TokenType>;

export const ResponsiveOverride = z.object({
  /** The media query text, e.g. "(min-width: 600px)". */
  media: z.string().min(1),
  value: z.string().min(1),
  source: SourceRef,
});
export type ResponsiveOverride = z.infer<typeof ResponsiveOverride>;

export const TokenCandidate = z.object({
  /** The custom property name without the leading dashes, e.g. "space-3". */
  id: z.string().regex(/^[a-z0-9-]+$/),
  type: TokenType,
  value: z.string().min(1),
  overrides: z.array(ResponsiveOverride),
  /** How many times `var(--id)` appears across the scanned files. */
  usageCount: z.number().int().nonnegative(),
  confidence: Confidence,
  source: SourceRef,
  /** The comment next to the declaration in the source, if any. */
  comment: z.string().optional(),
});
export type TokenCandidate = z.infer<typeof TokenCandidate>;

export const DriftClass = z.enum(['matches-token', 'near-token', 'one-off']);
export type DriftClass = z.infer<typeof DriftClass>;

export const HardCodedValue = z.object({
  kind: z.enum(['color', 'length']),
  /** Canonical form used for grouping, e.g. "#615e58" or "24px". */
  normalized: z.string().min(1),
  occurrences: z.array(SourceRef).min(1),
  classification: DriftClass,
  nearestToken: z.object({ id: z.string(), value: z.string(), distance: z.number().nonnegative() }).optional(),
  confidence: Confidence,
});
export type HardCodedValue = z.infer<typeof HardCodedValue>;

export const ComponentCandidate = z.object({
  /** The CSS block name, e.g. "button" for `.button` and `.button--primary`. */
  id: z.string().regex(/^[a-z0-9-]+$/),
  /**
   * component: a UI pattern; state: a state class like "is-open"; graphic: only used on SVG shapes.
   * Only components can be reusable candidates.
   */
  kind: z.enum(['component', 'state', 'graphic']),
  /** Component files (.tsx) that use the block. */
  usedIn: z.array(z.string()),
  usageCount: z.number().int().nonnegative(),
  /** HTML elements the block is applied to, e.g. ["a", "button", "span"]. */
  elements: z.array(z.string()),
  /** Modifier names found in CSS or JSX, e.g. ["primary"]. */
  modifiers: z.array(z.string()),
  /** Interactive states styled in CSS, e.g. ["hover", "focus-visible"]. */
  states: z.array(z.string()),
  /** Where the block's base CSS rule is declared. */
  styles: z.array(SourceRef),
  usages: z.array(SourceRef),
  /** Reusable means used in two or more component files. This is a rule, so it is inferred. */
  reusable: z.boolean(),
  confidence: Confidence,
  notes: z.array(z.string()),
});
export type ComponentCandidate = z.infer<typeof ComponentCandidate>;

export const AuditInventory = z.object({
  schemaVersion: z.literal(AUDIT_SCHEMA_VERSION),
  source: z.object({
    id: z.string().min(1),
    repo: z.url(),
    commit: z.string().regex(/^[0-9a-f]{40}$/),
  }),
  scanned: z.object({
    cssFiles: z.number().int().nonnegative(),
    componentFiles: z.number().int().nonnegative(),
  }),
  tokens: z.array(TokenCandidate),
  hardCoded: z.array(HardCodedValue),
  components: z.array(ComponentCandidate),
});
export type AuditInventory = z.infer<typeof AuditInventory>;
