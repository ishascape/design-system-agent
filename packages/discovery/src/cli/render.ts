/**
 * Usage: npm run render -- <source-id>
 *
 * Rendered evidence: serves a built copy of the source (static files only, no source scripts run
 * on the server), opens it in headless Chromium and records computed styles and screenshots of
 * each target in each state at each width. Targets live in sources/<id>/render.json.
 *
 * Writes audits/<id>/rendered/<target>.json and PNG screenshots.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Locator } from 'playwright';
import { z } from 'zod';
import { loadSourceConfig, sourceCacheDir } from '../source-config.ts';
import { serveStatic } from '../static-server.ts';

const RenderConfig = z.object({
  distDir: z.string().default('dist'),
  widths: z.array(z.number().int().min(200).max(3000)).min(1),
  targets: z.record(z.string().regex(/^[a-z0-9-]+$/), z.record(z.string().regex(/^[a-z0-9-]+$/), z.string().min(1))),
});

const STYLE_PROPS = [
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
  'color',
  'background-color',
  'border-top-width',
  'border-top-style',
  'border-top-color',
  'border-top-left-radius',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'min-height',
  'height',
  'width',
  'gap',
  'outline-style',
  'outline-width',
  'outline-color',
  'outline-offset',
  'cursor',
] as const;

/** Screenshot with a margin so outlines and decorations drawn outside the box are included. */
async function shot(el: Locator, path: string, margin = 12) {
  const box = await el.boundingBox();
  if (!box) throw new Error(`Element is not visible, cannot screenshot ${path}`);
  await el.page().screenshot({
    path,
    clip: {
      x: Math.max(0, box.x - margin),
      y: Math.max(0, box.y - margin),
      width: box.width + margin * 2,
      height: box.height + margin * 2,
    },
  });
}

async function styles(el: Locator, pseudo?: string) {
  return el.evaluate(
    (node, args) => {
      const cs = getComputedStyle(node, args.pseudo ?? null);
      return Object.fromEntries(args.props.map((p) => [p, cs.getPropertyValue(p)]));
    },
    { props: pseudo ? ['opacity', 'border-top-color', 'width', 'height', 'top', 'left'] : [...STYLE_PROPS], pseudo },
  );
}

const id = process.argv[2];
if (!id) {
  console.error('Usage: npm run render -- <source-id>');
  process.exit(1);
}
const root = process.cwd();
loadSourceConfig(root, id);
const cfg = RenderConfig.parse(JSON.parse(readFileSync(join(root, 'sources', id, 'render.json'), 'utf8')));
const dist = join(sourceCacheDir(root, id), cfg.distDir);
if (!existsSync(join(dist, 'index.html'))) {
  console.error(`No build at ${dist}. Build the pinned source first (see README, "Rendered evidence").`);
  process.exit(1);
}
const outDir = join(root, 'audits', id, 'rendered');
mkdirSync(outDir, { recursive: true });

const { server, url } = await serveStatic(dist);
const browser = await chromium.launch();
try {
  for (const [target, variants] of Object.entries(cfg.targets)) {
    const result: Record<string, unknown> = { target, widths: cfg.widths, variants: {} };
    for (const width of cfg.widths) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      for (const [variant, selector] of Object.entries(variants)) {
        const el = page.locator(selector).first();
        if ((await el.count()) === 0) {
          (result.variants as Record<string, unknown>)[`${variant}@${width}`] = {
            error: `No element matches ${selector}`,
          };
          continue;
        }
        await el.scrollIntoViewIfNeeded();
        const states: Record<string, unknown> = {};
        await page.mouse.move(0, 0);
        states.default = { box: await el.boundingBox(), styles: await styles(el) };
        await shot(el, join(outDir, `${target}-${variant}-default-${width}.png`));
        await el.hover();
        states.hover = { styles: await styles(el), before: await styles(el, '::before') };
        await shot(el, join(outDir, `${target}-${variant}-hover-${width}.png`));
        await page.mouse.move(0, 0);
        await page.keyboard.press('Escape');
        await el.focus();
        states.focus = {
          focusVisible: await el.evaluate((n) => n.matches(':focus-visible')),
          styles: await styles(el),
          before: await styles(el, '::before'),
        };
        await shot(el, join(outDir, `${target}-${variant}-focus-${width}.png`));
        (result.variants as Record<string, unknown>)[`${variant}@${width}`] = { selector, states };
      }
      await page.close();
    }
    writeFileSync(join(outDir, `${target}.json`), JSON.stringify(result, null, 2) + '\n');
    console.log(
      `Rendered ${target}: ${Object.keys(variants).length} variants × ${cfg.widths.length} widths × 3 states`,
    );
  }
} finally {
  await browser.close();
  server.close();
}
