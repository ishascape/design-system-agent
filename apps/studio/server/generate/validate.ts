/**
 * Quality checks on everything a run generated. Each check reports pass, fail or not run with a
 * plain detail line; nothing is marked passed unless it was actually checked.
 */
import postcss from 'postcss';
import type { ManifestToken } from '@dsa/tokens';

export interface Check {
  name: string;
  status: 'pass' | 'fail' | 'not-run';
  detail: string;
}

export interface ValidateInput {
  approvedCount: number;
  manifest: ManifestToken[];
  tokensCss: string;
  docsHtml?: string;
  catalog?: string;
  /** Why Figma was not checked, when its stage did not run. */
  figmaSkipped?: string;
}

const pass = (name: string, detail: string): Check => ({ name, status: 'pass', detail });
const fail = (name: string, detail: string): Check => ({ name, status: 'fail', detail });
const list = (xs: string[], max = 5) =>
  xs.slice(0, max).join(', ') + (xs.length > max ? ` and ${xs.length - max} more` : '');

export function validateOutputs(i: ValidateInput): Check[] {
  const checks: Check[] = [];
  const vars = i.manifest.map((t) => t.cssVar);

  // 1. Every approved token was built.
  checks.push(
    i.manifest.length === i.approvedCount
      ? pass('Every approved token was built', `${i.manifest.length} of ${i.approvedCount}`)
      : fail('Every approved token was built', `${i.manifest.length} built, ${i.approvedCount} approved`),
  );

  // 2. Every token traces back to a source line.
  const untraced = i.manifest.filter((t) => !t.provenance?.source || !t.provenance.confidence).map((t) => t.name);
  checks.push(
    untraced.length
      ? fail('Every token traces back to its source', `Missing provenance: ${list(untraced)}`)
      : pass('Every token traces back to its source', `${i.manifest.length} tokens with a source line and confidence`),
  );

  // 3. The CSS parses and declares each token exactly once at the top level.
  try {
    const root = postcss.parse(i.tokensCss);
    const counts = new Map<string, number>();
    root.walkRules((rule) => {
      if (rule.parent?.type !== 'root' || rule.selector.trim() !== ':root') return;
      rule.walkDecls((d) => {
        counts.set(d.prop, (counts.get(d.prop) ?? 0) + 1);
      });
    });
    const missing = vars.filter((v) => !counts.has(v));
    const twice = vars.filter((v) => (counts.get(v) ?? 0) > 1);
    checks.push(
      missing.length || twice.length
        ? fail(
            'CSS declares every token once',
            [missing.length ? `missing ${list(missing)}` : '', twice.length ? `declared twice ${list(twice)}` : '']
              .filter(Boolean)
              .join('; '),
          )
        : pass('CSS declares every token once', `${vars.length} custom properties in :root`),
    );
  } catch (e) {
    checks.push(fail('CSS declares every token once', `tokens.css does not parse: ${(e as Error).message}`));
  }

  // 4. Names are unique.
  const dupes = vars.filter((v, n) => vars.indexOf(v) !== n);
  checks.push(
    dupes.length
      ? fail('Token names are unique', `Duplicates: ${list([...new Set(dupes)])}`)
      : pass('Token names are unique', `${vars.length} distinct names`),
  );

  // 5. Docs and catalog cover every token, and the docs page runs no scripts.
  if (i.docsHtml === undefined) {
    checks.push({ name: 'Docs cover every token', status: 'not-run', detail: 'No documentation was generated' });
  } else {
    const absent = i.manifest.filter((t) => !i.docsHtml!.includes(`id="${t.name}"`)).map((t) => t.name);
    checks.push(
      absent.length
        ? fail('Docs cover every token', `Not documented: ${list(absent)}`)
        : pass('Docs cover every token', `${i.manifest.length} tokens documented`),
    );
    checks.push(
      /<script\b/i.test(i.docsHtml) || /<[^>]*\son[a-z]+\s*=/i.test(i.docsHtml)
        ? fail('Docs page contains no scripts', 'A script or event handler was found in the generated page')
        : pass('Docs page contains no scripts', 'No <script> or inline event handlers'),
    );
  }
  if (i.catalog === undefined) {
    checks.push({ name: 'Agent catalog covers every token', status: 'not-run', detail: 'No catalog was generated' });
  } else {
    const absent = vars.filter((v) => !i.catalog!.includes(`\`${v}\``));
    checks.push(
      absent.length
        ? fail('Agent catalog covers every token', `Missing: ${list(absent)}`)
        : pass('Agent catalog covers every token', `${vars.length} tokens listed`),
    );
  }

  // 6. Figma, when it ran. It is never reported as passed when it did not.
  if (i.figmaSkipped) checks.push({ name: 'Figma matches the tokens', status: 'not-run', detail: i.figmaSkipped });

  return checks;
}
