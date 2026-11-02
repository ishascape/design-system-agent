/**
 * Usage: npm run test:parity   (after npm run build-storybook and npm run render -- ashnidave)
 *
 * Compares computed styles of the generated Button (in Storybook) with the source Button
 * (audits/ashnidave/rendered/button.json) for each variant, state and width.
 * Known, documented exceptions are listed below; anything else fails.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { serveStatic } from '../../packages/discovery/src/static-server.ts';

const PROPS = [
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'color',
  'background-color',
  'border-top-width',
  'border-top-color',
  'border-top-left-radius',
  'padding-left',
  'padding-right',
  'min-height',
  'height',
  'gap',
  'outline-style',
  'outline-width',
  'outline-color',
  'outline-offset',
] as const;

/** Differences that are understood and recorded in the Button spec. */
const EXCEPTIONS: {
  match: (variant: string, width: number, state: string, prop: string) => boolean;
  reason: string;
}[] = [
  {
    match: (v, w, _s, p) =>
      v === 'primary' && w === 375 && ['font-size', 'line-height', 'padding-left', 'padding-right'].includes(p),
    reason: 'Hero page-level override of the primary button below 600px (spec: responsive notes).',
  },
];

const STORIES: Record<string, string> = {
  primary: 'components-button--primary',
  outline: 'components-button--outline',
};

type Styles = Record<string, string>;
interface Rendered {
  variants: Record<string, { states: Record<string, { styles: Styles }> } | { error: string }>;
}

const root = process.cwd();
const source = JSON.parse(readFileSync(join(root, 'audits/ashnidave/rendered/button.json'), 'utf8')) as Rendered;

async function capture(page: Page, state: string): Promise<Styles> {
  const el = page.locator('#storybook-root .ds-button').first();
  await page.mouse.move(0, 0);
  if (state === 'hover') await el.hover();
  if (state === 'focus') {
    await page.keyboard.press('Tab');
  }
  return el.evaluate(
    (n, props) => {
      const cs = getComputedStyle(n);
      return Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p)]));
    },
    [...PROPS],
  );
}

const { server, url } = await serveStatic(join(root, 'storybook-static'));
const browser = await chromium.launch();
const failures: string[] = [];
const excepted: string[] = [];
let compared = 0;
try {
  for (const [key, entry] of Object.entries(source.variants)) {
    if ('error' in entry) {
      failures.push(`${key}: source capture failed (${entry.error})`);
      continue;
    }
    const [variant, widthText] = key.split('@') as [string, string];
    const width = Number(widthText);
    for (const state of ['default', 'hover', 'focus']) {
      const page = await browser.newPage({ viewport: { width, height: 600 } });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(`${url}iframe.html?id=${STORIES[variant]}&viewMode=story`, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      const ours = await capture(page, state);
      const theirs = entry.states[state]?.styles ?? {};
      for (const prop of PROPS) {
        if (!(prop in theirs)) continue;
        compared++;
        if (ours[prop] === theirs[prop]) continue;
        const line = `${variant}@${width} ${state} ${prop}: source "${theirs[prop]}" vs generated "${ours[prop]}"`;
        const ex = EXCEPTIONS.find((e) => e.match(variant, width, state, prop));
        if (ex) excepted.push(`${line} (${ex.reason})`);
        else failures.push(line);
      }
      await page.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}

if (excepted.length) console.log(`Documented exceptions (${excepted.length}):\n  ${excepted.join('\n  ')}`);
if (failures.length) {
  console.error(
    `Parity failed: ${failures.length} of ${compared} style comparisons differ:\n  ${failures.join('\n  ')}`,
  );
  process.exit(1);
}
console.log(
  `Parity passed: ${compared} style comparisons match the source (${excepted.length} documented exceptions).`,
);
