/**
 * Drafts a component spec from evidence only: the component candidate found by discovery, the
 * CSS rules of its block, and the approved token map. Everything it fills in comes from the
 * source and says how it knows (observed or inferred). What needs a person's judgement (summary,
 * when to use, guidelines, keyboard behaviour) is listed in `needsYou`, never invented.
 *
 * Source CSS is parsed as text, never executed.
 */
import postcss from 'postcss';
import type { ComponentCandidate, Confidence } from '@dsa/registry';

export interface CssSource {
  path: string;
  content: string;
}

/** Canonical token name for each source custom property (without the leading --). */
export type TokenNames = Record<string, string>;

export interface SpecDraft {
  id: string;
  name: string;
  status: 'pending-approval';
  source: { id: string; commit: string; styles: string[]; usages: string[] };
  variants: { name: string; description: string; confidence: Confidence }[];
  states: { name: string; trigger: string; visual: string; confidence: Confidence }[];
  anatomy: { part: string; description: string; optional: boolean }[];
  tokens: { name: string; usedFor: string }[];
  /** Values written directly in the block's CSS: each is a token gap or a deliberate constant. */
  hardCoded: { property: string; value: string; at: string }[];
  /** Custom properties the block uses that are not approved tokens. */
  unapprovedVars: string[];
  accessibility: { elements: string[]; notes: string[] };
  needsYou: string[];
}

const STATE_NAMES = ['hover', 'focus-visible', 'active', 'disabled'] as const;
const TRIGGER: Record<(typeof STATE_NAMES)[number], string> = {
  hover: 'Pointer over the component',
  'focus-visible': 'Keyboard focus',
  active: 'While pressed',
  disabled: 'Not available',
};

const titleCase = (id: string) =>
  id
    .split('-')
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ');

interface RuleInfo {
  selector: string;
  at: string;
  decls: { prop: string; value: string }[];
}

/** Rules whose selector is about this block, with what they declare. */
function blockRules(id: string, files: CssSource[]): RuleInfo[] {
  const out: RuleInfo[] = [];
  const re = new RegExp(`\\.${id}(?![a-z0-9_-])|\\.${id}(__|--)[a-z0-9-]+`);
  for (const f of files) {
    postcss.parse(f.content, { from: f.path }).walkRules((rule) => {
      const sel = rule.selectors.filter((s) => re.test(s));
      if (!sel.length) return;
      const decls: RuleInfo['decls'] = [];
      rule.each((n) => {
        if (n.type === 'decl') decls.push({ prop: n.prop, value: n.value });
      });
      out.push({ selector: sel.join(', '), at: `${f.path}:${rule.source?.start?.line ?? 1}`, decls });
    });
  }
  return out;
}

/** What a selector part is about: the block itself, a modifier, an element, or a state. */
function describeSelector(id: string, selector: string) {
  const mod = new RegExp(`\\.${id}--([a-z0-9-]+)`).exec(selector)?.[1];
  const el = new RegExp(`\\.${id}__([a-z0-9-]+)`).exec(selector)?.[1];
  const state = STATE_NAMES.find((s) => new RegExp(`:${s}(?![a-z-])`).test(selector));
  return { mod, el, state };
}

const PROP_ROLE: [RegExp, string][] = [
  [/^(background|background-color)$/, 'background'],
  [/^color$/, 'text colour'],
  [/^(border|border-color|outline|outline-color|border-[a-z]+-color)$/, 'border'],
  [/^(border-width|outline-width|border-[a-z]+-width)$/, 'border width'],
  [/radius/, 'corner radius'],
  [/^(padding|padding-[a-z-]+|gap|margin|margin-[a-z-]+)$/, 'spacing'],
  [/^(font-size)$/, 'type size'],
  [/^(font-family|font)$/, 'font'],
  [/^(min-height|height|min-width|width|block-size|inline-size)$/, 'size'],
  [/^(transition|transition-duration|animation)$/, 'motion'],
  [/^box-shadow$/, 'shadow'],
];
const role = (prop: string) => PROP_ROLE.find(([re]) => re.test(prop))?.[1] ?? prop;

export function draftComponentSpec(
  c: ComponentCandidate,
  css: CssSource[],
  tokenNames: TokenNames,
  source: { id: string; commit: string },
): SpecDraft {
  const rules = blockRules(c.id, css);
  const usedFor = new Map<string, Set<string>>();
  const unapproved = new Set<string>();
  const hardCoded: SpecDraft['hardCoded'] = [];
  const partRoles = new Map<string, Set<string>>();
  const stateVisuals = new Map<string, Set<string>>();
  const modVisuals = new Map<string, Set<string>>();

  for (const r of rules) {
    const { mod, el, state } = describeSelector(c.id, r.selector);
    for (const d of r.decls) {
      if (d.prop.startsWith('--')) continue;
      const vars = [...d.value.matchAll(/var\(\s*--([a-z0-9-]+)/gi)].map((m) => m[1]!.toLowerCase());
      const what = `${role(d.prop)}${el ? ` of ${el}` : ''}${mod ? ` (${mod})` : ''}${state ? ` on ${state}` : ''}`;
      for (const v of vars) {
        const name = tokenNames[v];
        if (!name) {
          unapproved.add(`--${v}`);
          continue;
        }
        if (!usedFor.has(name)) usedFor.set(name, new Set());
        usedFor.get(name)!.add(what);
      }
      if (!vars.length && /\d|#/.test(d.value) && !/^(0|1|auto|none|inherit|initial|100%)$/.test(d.value.trim()))
        hardCoded.push({ property: d.prop, value: d.value, at: r.at });
      if (el) {
        if (!partRoles.has(el)) partRoles.set(el, new Set());
        partRoles.get(el)!.add(role(d.prop));
      }
      const tokenText = vars.map((v) => tokenNames[v] ?? `--${v}`).join(', ');
      const change = `${role(d.prop)}${el ? ` of ${el}` : ''}${tokenText ? ` → ${tokenText}` : ` → ${d.value}`}`;
      if (state && !mod) {
        if (!stateVisuals.has(state)) stateVisuals.set(state, new Set());
        stateVisuals.get(state)!.add(change);
      }
      if (mod && !state) {
        if (!modVisuals.has(mod)) modVisuals.set(mod, new Set());
        modVisuals.get(mod)!.add(change);
      }
    }
  }

  const list = (s: Set<string> | undefined, max = 4) => {
    const xs = [...(s ?? [])];
    return xs.slice(0, max).join('; ') + (xs.length > max ? `; and ${xs.length - max} more` : '');
  };

  const variants: SpecDraft['variants'] = [
    { name: 'default', description: 'The base style, with no modifier class.', confidence: 'observed' },
    ...c.modifiers.map((m) => ({
      name: m,
      description: modVisuals.has(m) ? `Changes ${list(modVisuals.get(m))}.` : `Modifier class .${c.id}--${m}.`,
      confidence: (modVisuals.has(m) ? 'observed' : 'inferred') as Confidence,
    })),
  ];
  const states: SpecDraft['states'] = [
    { name: 'default', trigger: 'At rest', visual: 'The base style.', confidence: 'observed' },
    ...STATE_NAMES.filter((s) => c.states.includes(s) || stateVisuals.has(s)).map((s) => ({
      name: s,
      trigger: TRIGGER[s],
      visual: stateVisuals.has(s) ? `Changes ${list(stateVisuals.get(s))}.` : 'Styled in the source.',
      confidence: 'observed' as Confidence,
    })),
  ];
  const anatomy: SpecDraft['anatomy'] = [
    {
      part: 'root',
      description: `The .${c.id} element (${c.elements.join(', ') || 'unknown element'}).`,
      optional: false,
    },
    ...[...partRoles].map(([part, roles]) => ({
      part,
      description: `.${c.id}__${part}: styles ${[...roles].slice(0, 4).join(', ')}.`,
      optional: true,
    })),
  ];
  const tokens = [...usedFor]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, uses]) => ({ name, usedFor: list(uses, 3) }));

  const interactive = c.elements.some((e) => ['a', 'button', 'input', 'select', 'textarea', 'summary'].includes(e));
  const a11yNotes = [
    ...c.notes,
    ...(c.states.includes('hover') && !c.states.includes('focus-visible') && interactive
      ? ['Hover is styled but keyboard focus (:focus-visible) is not.']
      : []),
  ];
  const needsYou = [
    'A one-line summary of what it is for',
    'When to use it, and when not to',
    'Do and don’t guidelines',
    interactive ? 'How it behaves with the keyboard' : 'Whether it is ever interactive',
    ...(tokens.length === 0 ? ['Which tokens it should use: its CSS uses none of the approved tokens'] : []),
    ...(unapproved.size ? [`Whether to approve these as tokens, or replace them: ${[...unapproved].join(', ')}`] : []),
    ...(hardCoded.length ? [`For each fixed value, a token or a reason it stays fixed (${hardCoded.length})`] : []),
  ];

  return {
    id: c.id,
    name: titleCase(c.id),
    status: 'pending-approval',
    source: {
      id: source.id,
      commit: source.commit,
      styles: c.styles.map((s) => `${s.file}:${s.line}`),
      usages: c.usages.map((u) => `${u.file}:${u.line}`),
    },
    variants,
    states,
    anatomy,
    tokens,
    hardCoded,
    unapprovedVars: [...unapproved].sort(),
    accessibility: { elements: c.elements, notes: a11yNotes },
    needsYou,
  };
}
