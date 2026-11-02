/**
 * Finds component candidates from BEM-style class names.
 *
 * JSX is parsed with the TypeScript compiler (never executed). For each class name we record
 * the element it is applied to and where. CSS tells us which modifiers and interactive states
 * each block styles. A block used in two or more component files is marked reusable.
 */
import ts from 'typescript';
import postcss from 'postcss';
import type { ComponentCandidate, SourceRef } from '@dsa/registry';
import type { CssFile } from './tokens.ts';

export interface ClassUsage {
  className: string;
  element: string;
  ref: SourceRef;
}

/** Split "button--primary" or "card__tags" into block / element / modifier. */
export function parseBem(className: string): { block: string; element?: string; modifier?: string } {
  const [beforeMod, modifier] = className.split('--', 2) as [string, string | undefined];
  const [block, element] = beforeMod.split('__', 2) as [string, string | undefined];
  return { block, ...(element ? { element } : {}), ...(modifier ? { modifier } : {}) };
}

/** Static class names in a className attribute: string literals and the static parts of templates. */
function staticClassNames(init: ts.JsxAttributeValue | undefined): string[] {
  if (!init) return [];
  const texts: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) texts.push(n.text);
    else if (ts.isTemplateExpression(n)) {
      texts.push(n.head.text);
      n.templateSpans.forEach((s) => texts.push(s.literal.text));
      n.templateSpans.forEach((s) => visit(s.expression));
    } else n.forEachChild(visit);
  };
  visit(init);
  return texts.flatMap((t) => t.split(/\s+/)).filter((c) => /^[a-z][a-z0-9_-]*$/.test(c));
}

export function findClassUsages(file: { path: string; content: string }): ClassUsage[] {
  const sf = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: ClassUsage[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxAttribute(node) && node.name.getText(sf) === 'className') {
      const opening = node.parent.parent;
      const element =
        ts.isJsxOpeningElement(opening) || ts.isJsxSelfClosingElement(opening)
          ? opening.tagName.getText(sf)
          : 'unknown';
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      for (const className of staticClassNames(node.initializer)) {
        out.push({ className, element, ref: { file: file.path, line } });
      }
    }
    node.forEachChild(visit);
  };
  visit(sf);
  return out;
}

const STATE_PSEUDOS = [
  'hover',
  'focus',
  'focus-visible',
  'focus-within',
  'active',
  'disabled',
  'checked',
  'visited',
] as const;

interface BlockStyles {
  modifiers: Set<string>;
  states: Set<string>;
  styles: SourceRef[];
}

export function findBlockStyles(files: CssFile[]): Map<string, BlockStyles> {
  const blocks = new Map<string, BlockStyles>();
  const get = (b: string) => {
    let s = blocks.get(b);
    if (!s) blocks.set(b, (s = { modifiers: new Set(), states: new Set(), styles: [] }));
    return s;
  };
  for (const file of files) {
    postcss.parse(file.content, { from: file.path }).walkRules((rule) => {
      for (const selector of rule.selectors) {
        for (const m of selector.matchAll(/\.([a-z][a-z0-9_-]*)((?::[a-z-]+(?:\([^)]*\))?)*)/g)) {
          const { block, element, modifier } = parseBem(m[1]!);
          const s = get(block);
          if (modifier && !element) s.modifiers.add(modifier);
          if (!element && !modifier && selector.trim() === `.${block}`) {
            s.styles.push({ file: file.path, line: rule.source?.start?.line ?? 1 });
          }
          for (const p of STATE_PSEUDOS) {
            if (!element && new RegExp(`:${p}(?![a-z-])`).test(m[2] ?? '')) s.states.add(p);
          }
          if (!element && /\[aria-(disabled|pressed|expanded|current)/.test(selector)) s.states.add('aria');
        }
      }
    });
  }
  return blocks;
}

const SVG_ELEMENTS = new Set([
  'svg',
  'g',
  'path',
  'circle',
  'rect',
  'line',
  'polyline',
  'polygon',
  'ellipse',
  'text',
  'tspan',
  'use',
  'defs',
  'marker',
  'mask',
  'clipPath',
  'pattern',
]);

export function blockKind(id: string, elements: string[]): ComponentCandidate['kind'] {
  if (/^(is|has)-/.test(id)) return 'state';
  if (elements.length > 0 && elements.every((e) => SVG_ELEMENTS.has(e))) return 'graphic';
  return 'component';
}

const sorted = (xs: Iterable<string>) => [...new Set(xs)].sort();

export function findComponentCandidates(
  componentFiles: { path: string; content: string }[],
  cssFiles: CssFile[],
): ComponentCandidate[] {
  const usages = componentFiles.flatMap(findClassUsages);
  const styles = findBlockStyles(cssFiles);
  const byBlock = new Map<string, { root: ClassUsage[]; all: ClassUsage[]; modifiers: Set<string> }>();

  for (const u of usages) {
    const { block, element, modifier } = parseBem(u.className);
    let b = byBlock.get(block);
    if (!b) byBlock.set(block, (b = { root: [], all: [], modifiers: new Set() }));
    b.all.push(u);
    if (!element) b.root.push(u);
    if (modifier && !element) b.modifiers.add(modifier);
  }

  const candidates: ComponentCandidate[] = [];
  for (const [id, b] of byBlock) {
    if (b.root.length === 0) continue; // only parts of other blocks, not a component on its own
    const css = styles.get(id);
    const usedIn = sorted(b.root.map((u) => u.ref.file));
    const elements = sorted(b.root.map((u) => u.element));
    const notes: string[] = [];
    const nonInteractive = elements.filter(
      (e) => !['a', 'button', 'input', 'select', 'textarea', 'summary'].includes(e),
    );
    if (css?.states.has('hover') && nonInteractive.length > 0 && elements.some((e) => ['a', 'button'].includes(e))) {
      notes.push(`Styled as interactive but also applied to non-interactive element(s): ${nonInteractive.join(', ')}.`);
    }
    if (!css || css.styles.length === 0) notes.push('No base CSS rule found for this block.');
    const kind = blockKind(id, elements);
    candidates.push({
      id,
      kind,
      usedIn,
      usageCount: b.root.length,
      elements,
      modifiers: sorted([...b.modifiers, ...(css?.modifiers ?? [])]),
      states: sorted(css?.states ?? []),
      styles: css?.styles ?? [],
      usages: b.root.map((u) => u.ref),
      reusable: kind === 'component' && usedIn.length >= 2,
      confidence: 'inferred',
      notes,
    });
  }
  return candidates.sort(
    (a, b) =>
      Number(b.reusable) - Number(a.reusable) ||
      b.usedIn.length - a.usedIn.length ||
      b.usageCount - a.usageCount ||
      a.id.localeCompare(b.id),
  );
}
