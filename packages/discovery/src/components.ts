/**
 * Finds component candidates from BEM-style class names.
 *
 * JSX is parsed with the TypeScript compiler (never executed). For each class name we record
 * the element it is applied to and where. CSS tells us which modifiers and interactive states
 * each block styles. A block used in two or more component files is marked reusable.
 *
 * For websites, the page's HTML stands in for component files: a block repeated on the page
 * with its own CSS rule is marked reusable.
 */
import ts from 'typescript';
import postcss from 'postcss';
import type { ComponentCandidate, SourceRef } from '@dsa/registry';
import type { CssFile } from './tokens.ts';

export interface ClassUsage {
  className: string;
  element: string;
  ref: SourceRef;
  /** Position of the element in its file, so `card card--wide` on one element counts once. */
  at: number;
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
        out.push({ className, element, ref: { file: file.path, line }, at: node.getStart(sf) });
      }
    }
    node.forEachChild(visit);
  };
  visit(sf);
  return out;
}

/** Blank out a region but keep its newlines, so line numbers after it stay right. */
const blank = (m: string) => m.replace(/[^\n]/g, ' ');

/**
 * Class names in HTML markup (a downloaded or rendered page), with the element and line.
 * Comments, scripts, styles and templates are skipped. The markup is only scanned as text.
 */
export function findHtmlClassUsages(file: { path: string; content: string }): ClassUsage[] {
  const text = file.content
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/<(script|style|template|noscript)\b[\s\S]*?<\/\1\s*>/gi, blank);
  const out: ClassUsage[] = [];
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1);
  const lineAt = (pos: number) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid]! <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  for (const m of text.matchAll(/<([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g)) {
    const attr = /(?:^|\s)class\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(m[2]!);
    if (!attr) continue;
    const element = m[1]!.toLowerCase();
    const line = lineAt(m.index);
    for (const className of (attr[1] ?? attr[2] ?? attr[3] ?? '').split(/\s+/)) {
      if (/^[a-z][a-z0-9_-]*$/.test(className))
        out.push({ className, element, ref: { file: file.path, line }, at: m.index });
    }
  }
  return out;
}

const isMarkup = (path: string) => /\.html?$/i.test(path);

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
  /** Declarations in the block's own base rules; utility classes have one or two. */
  declarations: number;
}

export function findBlockStyles(files: CssFile[]): Map<string, BlockStyles> {
  const blocks = new Map<string, BlockStyles>();
  const get = (b: string) => {
    let s = blocks.get(b);
    if (!s) blocks.set(b, (s = { modifiers: new Set(), states: new Set(), styles: [], declarations: 0 }));
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
            s.declarations += rule.nodes.filter((n) => n.type === 'decl').length;
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
  const usages = componentFiles.flatMap((f) => (isMarkup(f.path) ? findHtmlClassUsages(f) : findClassUsages(f)));
  const styles = findBlockStyles(cssFiles);
  const byBlock = new Map<string, { root: ClassUsage[]; all: ClassUsage[]; modifiers: Set<string> }>();

  for (const u of usages) {
    const { block, element, modifier } = parseBem(u.className);
    let b = byBlock.get(block);
    if (!b) byBlock.set(block, (b = { root: [], all: [], modifiers: new Set() }));
    b.all.push(u);
    const seen = b.root.some((r) => r.at === u.at && r.ref.file === u.ref.file);
    if (!element && !seen) b.root.push(u);
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
    // A page has no component files, so repetition on the page is the evidence instead: used at
    // least twice, with its own base CSS rule that is more than a utility class (parts, variants,
    // styled states, or three or more declarations).
    const onPage = b.root.filter((u) => isMarkup(u.ref.file)).length;
    const hasParts = b.all.some((u) => parseBem(u.className).element);
    const substantial =
      !!css?.styles.length && (hasParts || css.modifiers.size > 0 || css.states.size > 0 || css.declarations >= 3);
    const repeatedOnPage = onPage >= 2 && substantial;
    if (repeatedOnPage) notes.push(`Repeated ${onPage} times on the page.`);
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
      reusable: kind === 'component' && (usedIn.length >= 2 || repeatedOnPage),
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
