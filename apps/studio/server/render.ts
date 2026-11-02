/**
 * Renders a website in a sandboxed headless Chromium to capture what a static download misses:
 * styles built by JavaScript at runtime, and a screenshot as evidence.
 *
 * The page's own scripts do run (that is the point), but only inside Chromium's sandbox, in a
 * fresh profile with no stored logins, no downloads, no permissions, no service workers, and no
 * requests to this computer or the local network. Nothing the page produces is ever executed by
 * the Studio itself; captured CSS is treated as text like any other source.
 */
import type { Browser } from 'playwright';

export interface Rendered {
  /** CSS text of every readable stylesheet after the page settled, including injected ones. */
  css: string;
  screenshot: Buffer;
  title: string;
  /** The page's HTML after scripts ran, for finding repeated components. Read as text only. */
  html: string;
}

const MAX_HTML = 5 * 1024 * 1024;

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|0\.0\.0\.0)/;

/** Loads Playwright lazily: the Studio works without it, just without rendering. */
async function launch(): Promise<Browser | string> {
  try {
    const { chromium } = await import('playwright');
    return await chromium.launch({ headless: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return /Executable doesn't exist|browserType\.launch/.test(msg)
      ? 'No browser installed for rendering. Run `npx playwright install chromium` once to enable screenshots and JavaScript-built styles.'
      : `The browser could not start: ${msg.split('\n')[0]}`;
  }
}

export async function renderWebsite(
  url: string,
  signal: AbortSignal,
  log: (m: string) => void,
  opts: { allowPrivateHosts?: boolean } = {},
): Promise<Rendered | { unavailable: string }> {
  const browser = await launch();
  if (typeof browser === 'string') return { unavailable: browser };
  const abort = () => void browser.close();
  signal.addEventListener('abort', abort, { once: true });
  try {
    const target = new URL(url);
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      acceptDownloads: false,
      serviceWorkers: 'block',
      permissions: [],
      userAgent: 'DesignSystemStudio/0.1 (+render)',
    });
    let blocked = 0;
    await context.route('**/*', (route) => {
      const u = new URL(route.request().url());
      const okScheme = u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'data:';
      const local = PRIVATE_HOST.test(u.hostname) && !(opts.allowPrivateHosts && u.hostname === target.hostname);
      if (!okScheme || local) {
        blocked++;
        return route.abort('blockedbyclient');
      }
      return route.continue();
    });
    const page = await context.newPage();
    log(`Rendering ${url} in a sandboxed browser`);
    await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
    if (blocked) log(`Blocked ${blocked} requests to this computer, the local network or non-web addresses`);
    const css = await page.evaluate(() => {
      const out: string[] = [];
      const sheets = [...document.styleSheets, ...(document.adoptedStyleSheets ?? [])];
      for (const sheet of sheets) {
        try {
          out.push([...sheet.cssRules].map((r) => r.cssText).join('\n'));
        } catch {
          // Cross-origin stylesheets cannot be read; they are not the site's own styles anyway.
        }
      }
      return out.join('\n\n');
    });
    const screenshot = await page.screenshot({ type: 'png', fullPage: false });
    const title = await page.title();
    const html = (await page.content()).slice(0, MAX_HTML);
    log(`Rendered "${title}": ${css.length.toLocaleString()} characters of CSS, screenshot taken`);
    return { css, screenshot, title, html };
  } finally {
    signal.removeEventListener('abort', abort);
    await browser.close().catch(() => undefined);
  }
}
