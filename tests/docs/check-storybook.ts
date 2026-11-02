/**
 * Usage: npm run test:docs   (after npm run build-storybook)
 *
 * Opens every story and docs page of the built Storybook in headless Chromium and checks:
 * - it renders without page errors or console errors
 * - play functions (interaction tests) complete without throwing
 * - axe finds no serious or critical violations, including colour contrast (real rendering,
 *   unlike jsdom unit tests)
 * Exits non-zero on any failure.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { serveStatic } from '../../packages/discovery/src/static-server.ts';

interface IndexEntry {
  id: string;
  title: string;
  name: string;
  type: 'story' | 'docs';
}

const root = process.cwd();
const dist = join(root, 'storybook-static');
const index = JSON.parse(readFileSync(join(dist, 'index.json'), 'utf8')) as { entries: Record<string, IndexEntry> };
const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

const { server, url } = await serveStatic(dist);
const browser = await chromium.launch();
const failures: string[] = [];
let checked = 0;
try {
  for (const entry of Object.values(index.entries)) {
    const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)\.com/.test(m.text()))
        errors.push(`console: ${m.text()}`);
    });
    const viewMode = entry.type === 'docs' ? 'docs' : 'story';
    await page.goto(`${url}iframe.html?id=${entry.id}&viewMode=${viewMode}`, { waitUntil: 'networkidle' });
    const rootSel = entry.type === 'docs' ? '#storybook-docs' : '#storybook-root';
    await page.waitForSelector(`${rootSel} *`, { timeout: 15000 }).catch(() => errors.push('nothing rendered'));
    await page.evaluate(() => document.fonts.ready.then(() => undefined));

    if (entry.type === 'story') {
      // Wait for the story's render (including any play function) to finish.
      const phase = await page
        .waitForFunction(
          () => {
            const p = (window as unknown as { __STORYBOOK_PREVIEW__?: { currentRender?: { phase?: string } } })
              .__STORYBOOK_PREVIEW__?.currentRender?.phase;
            return p === 'finished' || p === 'completed' || p === 'errored' || p === 'aborted' ? p : false;
          },
          undefined,
          { timeout: 15000 },
        )
        .then((h) => h.jsonValue())
        .catch(() => 'timeout');
      if (phase !== 'finished' && phase !== 'completed') errors.push(`render phase: ${String(phase)}`);

      await page.addScriptTag({ content: axeSource });
      const violations = await page.evaluate(async () => {
        const axe = (
          window as unknown as {
            axe: {
              run: (
                ctx: unknown,
                opts: unknown,
              ) => Promise<{ violations: { id: string; impact: string; help: string }[] }>;
            };
          }
        ).axe;
        const r = await axe.run({ include: ['#storybook-root'] }, { resultTypes: ['violations'] });
        return r.violations
          .filter((v) => v.impact === 'serious' || v.impact === 'critical')
          .map((v) => `${v.id} (${v.impact}): ${v.help}`);
      });
      errors.push(...violations.map((v) => `axe: ${v}`));
    }
    checked++;
    if (errors.length) failures.push(`${entry.title} / ${entry.name}:\n    ${errors.join('\n    ')}`);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}

if (failures.length) {
  console.error(`Docs check failed for ${failures.length} of ${checked} entries:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log(
  `Docs check passed: ${checked} stories and docs pages rendered, play functions completed, no serious axe violations.`,
);
