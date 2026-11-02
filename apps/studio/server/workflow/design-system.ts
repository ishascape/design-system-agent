/**
 * The design-system workflow (v1): a fixed sequence of ten stages. Each stage calls the same
 * pipeline packages the command line uses, so the Studio and the CLI can never disagree.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { AuditInventory, TokenCandidate } from '@dsa/registry';
import { renderComponentsReport, renderDriftReport, runAudit, toDtcgCandidates } from '@dsa/discovery';
import { TokenMap, buildTokens, promoteTokens, promotionBlocker, toDtcgToken } from '@dsa/tokens';
import { allowLocalSites, fetchRepo, fetchWebsite, type FetchedSource } from '../sources.ts';
import { renderWebsite } from '../render.ts';
import { StepBlocked, type StepContext, type StepDefinition, type WorkflowDefinition } from './types.ts';

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const inventoryOf = (ctx: StepContext): AuditInventory => {
  const d = ctx.outputs.discover as { inventoryPath: string } | undefined;
  if (!d) throw new Error('Discover has not produced an inventory in this run');
  return readJson<AuditInventory>(join(ctx.workspace, d.inventoryPath));
};

/** Proposed canonical name for a source custom property, e.g. --text-body -> font.size.body. */
export function proposeName(t: Pick<TokenCandidate, 'id' | 'type'>): string {
  const id = t.id;
  const rules: [RegExp, (m: RegExpExecArray) => string][] = [
    [/^(?:space|spacing)-(.+)$/, (m) => `space.${m[1]}`],
    [/^radius(?:-(.+))?$/, (m) => `radius.${m[1] ?? 'default'}`],
    [/^line-(.+)$/, (m) => `line.${m[1]}`],
    [/^(?:text|font-size)-(.+)$/, (m) => `font.size.${m[1]}`],
    [/^font-(.+)$/, (m) => `font.family.${m[1]}`],
    [/^(?:dur|duration)-(.+)$/, (m) => `motion.duration.${m[1]}`],
    [/^ease-(.+)$/, (m) => `motion.easing.${m[1]}`],
    [/^(?:color|colour)-(.+)$/, (m) => `color.${m[1]}`],
  ];
  for (const [re, f] of rules) {
    const m = re.exec(id);
    if (m) return f(m);
  }
  const group: Record<string, string> = {
    color: 'color',
    fontFamily: 'font.family',
    duration: 'motion.duration',
    cubicBezier: 'motion.easing',
    dimension: 'size',
    number: 'number',
    other: 'other',
  };
  return `${group[t.type] ?? 'other'}.${id}`;
}

export interface TokenProposal {
  cssVar: string;
  type: string;
  value: string;
  usageCount: number;
  source: string;
  proposedName: string;
  promotable: boolean;
  reason?: string;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const importSource: StepDefinition = {
  key: 'import-source',
  title: 'Import source',
  description: 'Connects to the source and makes a pinned, read-only copy.',
  action: 'Fetching the source',
  params: z.object({
    /** Repositories: the branch, tag or commit to import. */
    ref: z.string().min(1).default('HEAD'),
    /** Websites: render in a sandboxed browser. auto uses rendered styles only if the HTML had none. */
    render: z.enum(['auto', 'always', 'off']).default('auto'),
  }),
  async run(ctx) {
    const dir = join(ctx.workspace, 'sources', ctx.source.id);
    let got: FetchedSource;
    const warnings: string[] = [];
    if (ctx.source.kind === 'github') {
      got = await fetchRepo(ctx.source.url, String(ctx.params.ref), join(dir, 'repo'), ctx.signal, ctx.log);
    } else if (ctx.source.kind === 'website') {
      got = await fetchWebsite(ctx.source.url, join(dir, 'site'), ctx.signal, ctx.log);
      const mode = String(ctx.params.render);
      if (mode !== 'off') {
        const r = await renderWebsite(ctx.source.url, ctx.signal, ctx.log, { allowPrivateHosts: allowLocalSites() });
        if ('unavailable' in r) {
          warnings.push(r.unavailable);
          ctx.log(r.unavailable, 'warn');
        } else {
          ctx.saveArtifact('screenshot', 'screenshot.png', r.screenshot, 'image/png');
          // The rendered page is what people see, so components are looked for there.
          writeFileSync(join(got.dir, 'page.rendered.html'), r.html);
          got = { ...got, commit: createHash('sha1').update(got.commit).update(r.html).digest('hex') };
          if (mode === 'always' || !got.styles) {
            const styles = join(got.dir, 'styles');
            if (mode === 'always') rmSync(styles, { recursive: true, force: true });
            mkdirSync(styles, { recursive: true });
            writeFileSync(join(styles, 'rendered.css'), r.css);
            got = {
              ...got,
              commit: createHash('sha1').update(got.commit).update(r.css).digest('hex'),
              styles: 1,
            };
            ctx.log('Using the styles captured from the rendered page');
          }
        }
      }
      if (!got.styles) throw new Error('The page has no same-origin styles to analyse, even after rendering');
    } else {
      throw new StepBlocked(
        ctx.source.kind === 'figma'
          ? 'Importing from a Figma file is not available yet. Add the GitHub repository or website for now.'
          : 'Importing an existing design-system package is not available yet.',
      );
    }
    const rel = got.dir.slice(ctx.workspace.length + 1);
    return {
      summary: {
        headline: `${ctx.source.kind === 'github' ? 'Repository' : 'Website'} copied at ${got.commit.slice(0, 7)}`,
        facts: [
          { label: 'Source', value: ctx.source.url },
          { label: ctx.source.kind === 'github' ? 'Commit' : 'Snapshot hash', value: got.commit },
          { label: 'Files', value: String(got.files) },
        ],
        warnings,
      },
      output: {
        dir: rel,
        commit: got.commit,
        ref: got.ref,
        kind: ctx.source.kind,
        ...(ctx.source.kind === 'website'
          ? { markup: existsSync(join(got.dir, 'page.rendered.html')) ? 'page.rendered.html' : 'page.html' }
          : {}),
      },
    };
  },
};

const discover: StepDefinition = {
  key: 'discover',
  title: 'Discover',
  description: 'Reads the styles and component code (without running it) and builds an inventory.',
  action: 'Reading styles and components',
  run(ctx) {
    const src = ctx.outputs['import-source'] as { dir: string; commit: string; markup?: string };
    const inv = runAudit(
      join(ctx.workspace, src.dir),
      { id: ctx.source.id, repo: ctx.source.url, commit: src.commit },
      src.markup ? { markup: [src.markup] } : {},
    );
    const art = ctx.saveArtifact('inventory', 'inventory.json', JSON.stringify(inv, null, 2), 'application/json');
    const code = inv.scanned.componentFiles - (src.markup ? 1 : 0);
    const read = src.markup
      ? `${plural(inv.scanned.cssFiles, 'stylesheet')} and the page's HTML read`
      : `${plural(inv.scanned.cssFiles, 'stylesheet')} and ${plural(code, 'component file')} read`;
    ctx.log(src.markup ? `Read ${src.markup} for repeated components` : `Scanned ${code} component files`);
    const warnings: string[] = [];
    if (inv.scanned.cssFiles === 0)
      warnings.push('No CSS files found. Projects that style only with Tailwind or CSS-in-JS are not supported yet.');
    return {
      summary: {
        headline: read,
        facts: [
          { label: 'Custom properties', value: String(inv.tokens.length) },
          { label: 'Hard-coded values', value: String(inv.hardCoded.length) },
          { label: 'CSS blocks', value: String(inv.components.length) },
        ],
        warnings,
      },
      output: { inventoryPath: art.path, artifactId: art.id },
    };
  },
};

const extractTokens: StepDefinition = {
  key: 'extract-tokens',
  title: 'Extract tokens',
  description: 'Turns custom properties into token candidates with types, values and provenance.',
  action: 'Classifying foundations',
  run(ctx) {
    const inv = inventoryOf(ctx);
    ctx.saveArtifact(
      'token-candidates',
      'tokens-candidates.tokens.json',
      JSON.stringify(toDtcgCandidates(inv), null, 2),
      'application/json',
    );
    const proposals: TokenProposal[] = inv.tokens.map((t) => {
      let reason = promotionBlocker(t);
      if (!reason) {
        try {
          toDtcgToken(t, inv.source.commit);
        } catch (e) {
          reason = e instanceof Error ? e.message : String(e);
        }
      }
      const promotable = !reason;
      return {
        cssVar: `--${t.id}`,
        type: t.type,
        value: t.value,
        usageCount: t.usageCount,
        source: `${t.source.file}:${t.source.line}`,
        proposedName: proposeName(t),
        promotable,
        ...(reason ? { reason } : {}),
      };
    });
    const byType = new Map<string, number>();
    for (const p of proposals) byType.set(p.type, (byType.get(p.type) ?? 0) + 1);
    const skipped = proposals.filter((p) => !p.promotable);
    return {
      summary: {
        headline: `${proposals.length - skipped.length} token candidates`,
        facts: [...byType].map(([type, n]) => ({ label: type, value: String(n) })),
        warnings: skipped.map((p) => `${p.cssVar} is left out of review: ${p.reason}`),
      },
      output: { proposals },
    };
  },
};

const identifyComponents: StepDefinition = {
  key: 'identify-components',
  title: 'Identify components',
  description: 'Finds reusable components, their variants and the states they style.',
  action: 'Grouping CSS blocks into components',
  run(ctx) {
    const inv = inventoryOf(ctx);
    ctx.saveArtifact('components-report', 'components.md', renderComponentsReport(inv), 'text/markdown');
    const reusable = inv.components.filter((c) => c.kind === 'component' && c.reusable);
    const candidates = reusable.map((c) => ({
      id: c.id,
      usedIn: c.usedIn.length,
      uses: c.usageCount,
      elements: c.elements,
      modifiers: c.modifiers,
      states: c.states,
      styles: c.styles.map((s) => `${s.file}:${s.line}`),
      notes: c.notes,
      ...(c.usedIn.every((f) => /\.html?$/.test(f)) ? { onPage: true } : {}),
    }));
    return {
      summary: {
        headline: `${reusable.length} reusable component candidates`,
        facts: [
          { label: 'With variants', value: String(reusable.filter((c) => c.modifiers.length).length) },
          { label: 'With styled states', value: String(reusable.filter((c) => c.states.length).length) },
          {
            label: 'Single-use blocks',
            value: String(inv.components.filter((c) => c.kind === 'component' && !c.reusable).length),
          },
        ],
        warnings: reusable.flatMap((c) => c.notes.map((n) => `${c.id}: ${n}`)),
      },
      output: { candidates },
    };
  },
};

const audit: StepDefinition = {
  key: 'audit',
  title: 'Audit',
  description: 'Finds values written directly in CSS that drift from the tokens.',
  action: 'Checking for drift and duplication',
  run(ctx) {
    const inv = inventoryOf(ctx);
    ctx.saveArtifact('drift-report', 'drift-report.md', renderDriftReport(inv), 'text/markdown');
    const count = (kind: string, cls: string) =>
      inv.hardCoded
        .filter((h) => h.kind === kind && h.classification === cls)
        .reduce((n, h) => n + h.occurrences.length, 0);
    const near = count('color', 'near-token') + count('length', 'near-token');
    return {
      summary: {
        headline: `${near} uses are close to a token but not using it`,
        facts: [
          { label: 'Colours matching a token', value: String(count('color', 'matches-token')) },
          { label: 'Colours near a token', value: String(count('color', 'near-token')) },
          { label: 'One-off colours', value: String(count('color', 'one-off')) },
          { label: 'Lengths near a token', value: String(count('length', 'near-token')) },
        ],
        warnings: near ? [`${near} hard-coded values are probably drift; see the drift report.`] : [],
      },
      output: {
        hardCoded: inv.hardCoded
          .filter((h) => h.classification !== 'matches-token')
          .slice(0, 50)
          .map((h) => ({
            kind: h.kind,
            value: h.normalized,
            uses: h.occurrences.length,
            classification: h.classification,
            nearest: h.nearestToken ? `--${h.nearestToken.id}` : null,
            first: `${h.occurrences[0]!.file}:${h.occurrences[0]!.line}`,
          })),
      },
    };
  },
};

const ReviewDecision = z.object({
  /** Custom properties (e.g. "--paper") to leave out of the design system. */
  exclude: z.array(z.string()).default([]),
  /** Canonical names to use instead of the proposed ones, keyed by custom property. */
  rename: z.record(z.string(), z.string()).default({}),
});

const review: StepDefinition = {
  key: 'review',
  title: 'Review & approve',
  description: 'You decide which tokens and names become the design system.',
  action: 'Preparing proposals',
  run(ctx) {
    const all = (ctx.outputs['extract-tokens'] as { proposals: TokenProposal[] }).proposals;
    const proposals = all.filter((p) => p.promotable);
    // Shown in the review panel with their reason, so nothing disappears silently.
    const skipped = all.filter((p) => !p.promotable);
    const components = (ctx.outputs['identify-components'] as { candidates: unknown[] }).candidates;
    return {
      summary: {
        headline: `${proposals.length} tokens and ${components.length} components to review`,
        facts: [
          { label: 'Tokens proposed', value: String(proposals.length) },
          { label: 'Components found', value: String(components.length) },
          ...(skipped.length ? [{ label: 'Left out, with a reason', value: String(skipped.length) }] : []),
        ],
        warnings: [],
      },
      output: { tokens: proposals, skipped, components },
    };
  },
  approval: {
    prompt: 'Approve the token names to create the project registry',
    onApprove(ctx) {
      const d = ReviewDecision.parse(ctx.decision ?? {});
      const pending = ctx.pending as { tokens: TokenProposal[] };
      const chosen = pending.tokens.filter((t) => !d.exclude.includes(t.cssVar));
      if (!chosen.length) throw new Error('Keep at least one token');
      const map = TokenMap.parse({
        source: ctx.source.id,
        status: 'approved',
        tokens: Object.fromEntries(
          chosen.map((t) => [d.rename[t.cssVar] ?? t.proposedName, { from: t.cssVar.slice(2) }]),
        ),
      });
      if (Object.keys(map.tokens).length !== chosen.length)
        throw new Error('Two tokens have the same name; rename one of them');
      const dir = join(ctx.workspace, 'registry');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'token-map.json'), JSON.stringify(map, null, 2) + '\n');
      ctx.saveArtifact('token-map', 'token-map.json', JSON.stringify(map, null, 2) + '\n', 'application/json');
      return {
        summary: {
          headline: `${chosen.length} tokens approved`,
          facts: [
            { label: 'Approved', value: String(chosen.length) },
            { label: 'Left out', value: String(pending.tokens.length - chosen.length) },
            { label: 'Renamed', value: String(Object.keys(d.rename).length) },
          ],
          warnings: [],
        },
        output: { tokenMapPath: 'registry/token-map.json', approved: chosen.length },
      };
    },
  },
};

const generateCode: StepDefinition = {
  key: 'generate-code',
  title: 'Generate code',
  description: 'Builds the canonical tokens and the CSS and manifest that components use.',
  action: 'Building tokens',
  async run(ctx) {
    const inv = inventoryOf(ctx);
    const mapPath = join(ctx.workspace, 'registry', 'token-map.json');
    if (!existsSync(mapPath)) throw new Error('No approved token map. Approve the review step first.');
    const map = TokenMap.parse(readJson(mapPath));
    const tokens = promoteTokens(inv, map);
    const tokensFile = join(ctx.workspace, 'registry', 'tokens.json');
    writeFileSync(tokensFile, JSON.stringify(tokens, null, 2) + '\n');
    const outDir = join(ctx.workspace, 'build', ctx.runId, 'tokens');
    const manifest = await buildTokens(tokensFile, outDir);
    ctx.saveArtifact('tokens-dtcg', 'tokens.json', JSON.stringify(tokens, null, 2) + '\n', 'application/json');
    ctx.saveArtifact('tokens-css', 'tokens.css', readFileSync(join(outDir, 'tokens.css')), 'text/css');
    const mf = ctx.saveArtifact(
      'tokens-manifest',
      'tokens.manifest.json',
      readFileSync(join(outDir, 'tokens.manifest.json')),
      'application/json',
    );
    ctx.log(`Built ${manifest.length} tokens with Style Dictionary`);
    return {
      summary: {
        headline: `${manifest.length} tokens built as CSS and a manifest`,
        facts: [
          { label: 'Tokens', value: String(manifest.length) },
          { label: 'Responsive', value: String(manifest.filter((t) => t.responsive?.length).length) },
          { label: 'Fluid', value: String(manifest.filter((t) => t.fluid).length) },
        ],
        warnings: [
          'Components are generated from approved component specs; this project has none yet, so only tokens were built.',
        ],
      },
      output: { manifestArtifactId: mf.id, count: manifest.length },
    };
  },
};

const notYet = (key: string, title: string, description: string, action: string): StepDefinition => ({
  key,
  title,
  description,
  action,
  run() {
    throw new StepBlocked(`${title} is not connected to the Studio yet. It is the next milestone.`);
  },
});

export const designSystemWorkflow: WorkflowDefinition = {
  id: 'design-system-v1',
  title: 'Design system analysis',
  steps: [
    importSource,
    discover,
    extractTokens,
    identifyComponents,
    audit,
    review,
    generateCode,
    notYet(
      'generate-figma',
      'Generate Figma',
      'Creates native, editable Figma variables and components.',
      'Preparing the Figma sync',
    ),
    notYet(
      'generate-docs',
      'Generate documentation',
      'Builds the documentation site and the agent catalog.',
      'Building docs',
    ),
    notYet(
      'validate',
      'Validate & publish',
      'Runs every quality check and prepares approved outputs.',
      'Running checks',
    ),
  ],
};
