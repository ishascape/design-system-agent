/**
 * Browser smoke test of the Design System Studio: the real server, the real built interface and
 * a real git repository (the mini-site fixture). It drives the interface the way a person would:
 * create a project, start a run, review and approve tokens, then check the results persist.
 *
 *   npm run build -w @dsa/studio && npm run test:studio-ui
 *
 * Screenshots go to .cache/studio-smoke/.
 */
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright';

const root = resolve(import.meta.dirname, '../..');
const shots = join(root, '.cache/studio-smoke');
const home = mkdtempSync(join(tmpdir(), 'studio-smoke-'));
const port = 4399;
const base = `http://localhost:${port}`;

// A real git repository to import.
const repo = join(home, 'fixture-repo');
cpSync(join(root, 'tests/fixtures/mini-site'), repo, { recursive: true });
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
git('init', '-q', '-b', 'main');
git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', 'add', '.');
git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', 'commit', '-q', '-m', 'fixture');

const server = spawn(
  process.execPath,
  ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', 'apps/studio/server/main.ts'],
  {
    cwd: root,
    env: { ...process.env, STUDIO_HOME: join(home, 'data'), STUDIO_PORT: String(port), STUDIO_ALLOW_FILE_SOURCES: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));

const checks: string[] = [];
const ok = (msg: string) => {
  checks.push(msg);
  console.log(`  ✓ ${msg}`);
};

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Server did not start:\n${serverLog}`);
}

const stageStatus = (page: Page, key: string) =>
  page.getByTestId(`stage-${key}`).locator('[data-status]').getAttribute('data-status');
async function waitStage(page: Page, key: string, status: string, timeout = 30_000) {
  await page.getByTestId(`stage-${key}`).locator(`[data-status="${status}"]`).waitFor({ timeout });
}

let exitCode = 0;
const browser = await chromium.launch();
try {
  await waitForServer();
  mkdirSync(shots, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  let restarting = false;
  let refusing = false;
  // Killing the server on purpose (step 8) cuts the live-update stream, and the deliberately wrong
  // Figma result (step 5b) is answered with 400. Only those are tolerated.
  const expected = (t: string) =>
    (restarting && /ERR_INCOMPLETE_CHUNKED_ENCODING|ERR_CONNECTION_REFUSED/.test(t)) ||
    (refusing && /status of 400/.test(t));
  page.on('console', (m) => m.type() === 'error' && !expected(m.text()) && consoleErrors.push(m.text()));
  page.on('pageerror', (e) => consoleErrors.push(e.message));

  // 1. Empty dashboard
  await page.goto(base);
  await page.getByRole('heading', { name: 'No projects yet' }).waitFor();
  await page.screenshot({ path: join(shots, '1-empty.png') });
  ok('Empty projects dashboard renders');

  // 2. Create a project with a repository source
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Name').fill('Mini site');
  await page.getByLabel('Description (optional)').fill('Smoke test project');
  await page.getByText('Repository', { exact: true }).click();
  await page.getByLabel(/^Link/).fill(`file://${repo}`);
  await page.screenshot({ path: join(shots, '2-new-project.png') });
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByTestId('stage-import-source').waitFor();
  const projectId = /#\/p\/(prj_[0-9a-f]{16})\//.exec(page.url())?.[1];
  if (!projectId) throw new Error(`Unexpected URL after create: ${page.url()}`);
  ok(`Project created (${projectId}) and the workflow canvas opened with 10 stages`);
  if ((await page.locator('.stage').count()) !== 10) throw new Error('Expected 10 stages on the canvas');

  // 3. Start a run; it executes for real and pauses at review
  // A slow CPU (as on CI runners) once left canvas nodes hidden after rapid live updates.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.SMOKE_CPU_SLOWDOWN ?? 4) });
  await page.getByRole('button', { name: 'Start run' }).click();
  await page.getByTestId('stage-review').locator('[data-status="awaiting-approval"]').waitFor({ state: 'attached' });
  await page.waitForTimeout(1500);
  const hidden = await page
    .locator('.react-flow__node')
    .evaluateAll((els) => els.filter((e) => getComputedStyle(e).visibility === 'hidden').length);
  if (hidden) throw new Error(`${hidden} canvas stages are hidden after the run updated`);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await waitStage(page, 'review', 'awaiting-approval');
  for (const k of ['import-source', 'discover', 'extract-tokens', 'identify-components', 'audit']) {
    if ((await stageStatus(page, k)) !== 'succeeded') throw new Error(`${k} did not succeed`);
  }
  if ((await stageStatus(page, 'generate-code')) !== 'pending')
    throw new Error('generate-code should wait for approval');
  ok('Run executed import → audit and paused at Review & approve; later stages are waiting');
  await page.getByRole('region', { name: 'Approval needed' }).waitFor();
  await page.screenshot({ path: join(shots, '3-awaiting-approval.png') });
  ok('Inspector opened on the approval with the proposed tokens');

  // 4. Inspect an earlier stage: summary, logs and artifacts are real
  await page.getByTestId('stage-discover').click();
  await page.getByRole('tab', { name: 'Logs' }).click();
  await page.locator('.log').first().waitFor();
  await page.getByRole('tab', { name: 'Artifacts' }).click();
  await page.locator('.artifact').first().click();
  await page.locator('.json--file').waitFor();
  await page.screenshot({ path: join(shots, '4-inspect-discover.png') });
  ok('Discover stage shows its logs and opens its saved inventory file');

  // 5. Approve with one token left out and one renamed
  await page.getByTestId('stage-review').click();
  const approval = page.getByRole('region', { name: 'Approval needed' });
  const boxes = approval.getByRole('checkbox', { name: /^Keep --/ });
  const total = await boxes.count();
  if (total < 2) throw new Error(`Expected at least 2 proposed tokens, saw ${total}`);
  const excludedLabel = (await boxes.nth(0).getAttribute('aria-label'))!.replace('Keep ', '');
  await boxes.nth(0).uncheck();
  const renameTarget = (await boxes.nth(1).getAttribute('aria-label'))!.replace('Keep ', '');
  await approval.getByLabel(`Name for ${renameTarget}`).fill('color.smoke-renamed');
  await approval.getByLabel('Decision note').fill('Smoke test approval');
  await approval.getByRole('button', { name: `Approve ${total - 1} tokens` }).click();
  await waitStage(page, 'generate-code', 'succeeded');
  await waitStage(page, 'generate-docs', 'succeeded');
  await waitStage(page, 'generate-figma', 'awaiting-approval');
  ok(
    `Approved ${total - 1} of ${total} tokens (left out ${excludedLabel}, renamed ${renameTarget}); code and docs were generated`,
  );

  // 5b. Figma hand-off: copy the tokens, do what the Figma plugin does, paste its result back.
  const handoff = page.getByRole('region', { name: 'Figma hand-off' });
  await handoff.waitFor();
  await page.screenshot({ path: join(shots, '5b-figma-handoff.png') });
  await handoff.getByRole('button', { name: 'Copy tokens for Figma' }).click();
  await handoff.getByText('Copied.').waitFor();
  const copiedPayload = JSON.parse(await page.evaluate(() => navigator.clipboard.readText())) as {
    collectionName: string;
    variables: { figmaName: string; figmaType: string; value: string | number; scopes: string[]; cssVar: string }[];
  };
  if (!copiedPayload.variables.some((v) => v.figmaName === 'color/smoke-renamed'))
    throw new Error('The copied Figma tokens lack the renamed token');
  const pluginResult = {
    kind: 'dsa-figma-variables-readback',
    fileName: 'Smoke file',
    collection: { id: 'VariableCollectionId:1:1', name: copiedPayload.collectionName, modes: 1 },
    variables: copiedPayload.variables.map((v, i) => ({
      id: `VariableID:1:${i}`,
      name: v.figmaName,
      type: v.figmaType,
      value: v.value,
      scopes: v.scopes,
      web: `var(${v.cssVar})`,
    })),
    created: copiedPayload.variables.length,
    updated: 0,
  };
  // A result that does not match is refused with the reason.
  const bad = structuredClone(pluginResult);
  bad.variables = bad.variables.slice(1);
  await handoff.getByLabel('Result from the Figma plugin').fill(JSON.stringify(bad));
  refusing = true;
  await handoff.getByRole('button', { name: 'Check Figma result' }).click();
  await page.getByText(/Figma does not match the tokens yet: .* is missing in Figma/).waitFor();
  refusing = false;
  await handoff.getByLabel('Result from the Figma plugin').fill(JSON.stringify(pluginResult));
  await handoff.getByRole('button', { name: 'Check Figma result' }).click();
  await waitStage(page, 'generate-figma', 'succeeded');
  await waitStage(page, 'validate', 'succeeded');
  ok('Figma hand-off: copied tokens, a wrong plugin result was refused, the matching one passed and Validate ran');
  await page.getByTestId('stage-generate-code').click();
  await page.screenshot({ path: join(shots, '5-after-approval.png') });

  // 6. Foundations shows the built tokens, including the rename and not the excluded one
  await page.getByRole('link', { name: 'Foundations' }).click();
  await page.getByText('color.smoke-renamed').waitFor();
  const builtRows = await page.locator('.table tbody tr').count();
  if (builtRows !== total - 1) throw new Error(`Foundations shows ${builtRows} tokens, expected ${total - 1}`);
  if (await page.locator('.table').getByText(excludedLabel, { exact: true }).count())
    throw new Error('Excluded token is in the built set');
  await page.screenshot({ path: join(shots, '6-foundations.png') });
  ok(`Foundations lists the ${builtRows} built tokens with the rename applied`);

  // 6b. Components: a draft spec is built from the source and lists what needs a person
  await page.getByRole('link', { name: 'Components' }).click();
  await page.getByRole('button', { name: 'Draft a spec' }).first().click();
  await page.getByRole('heading', { name: 'Needs you' }).waitFor();
  ok('Components: "Draft a spec" shows a draft built from the source and what still needs a person');

  // 7. Changes and Exports
  await page.getByRole('link', { name: 'Changes' }).click();
  await page.getByText('Smoke test approval').waitFor();
  ok('Changes records the approval and its note');
  await page.getByRole('link', { name: 'Exports' }).click();
  await page.getByText('Design tokens (CSS variables)').waitFor();
  const dl = await page.request.get(
    await page
      .getByRole('row', { name: /CSS variables/ })
      .getByRole('link', { name: 'Download' })
      .getAttribute('href')
      .then((h) => base + h),
  );
  const css = await dl.text();
  if (!css.includes('--color-smoke-renamed')) throw new Error('Downloaded CSS lacks the renamed token');
  await page.screenshot({ path: join(shots, '7-exports.png') });
  ok('Exports downloads the generated CSS, which contains the renamed token');

  // 7b. The generated documentation site, in a sandboxed frame
  await page.getByRole('link', { name: 'Documentation' }).click();
  await page.getByRole('button', { name: /Documentation site/ }).click();
  const docs = page.frameLocator('iframe[title="Documentation site"]');
  await docs.getByText('color.smoke-renamed', { exact: true }).waitFor();
  if (await docs.getByText(excludedLabel, { exact: true }).count())
    throw new Error('The excluded token appears in the docs site');
  await page.screenshot({ path: join(shots, '7b-docs-site.png') });
  ok('Documentation shows the generated docs site with the renamed token and without the excluded one');

  // 8. Persistence: restart the server and reload
  restarting = true;
  server.kill('SIGTERM');
  await new Promise((r) => server.once('exit', r));
  const again = spawn(
    process.execPath,
    ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', 'apps/studio/server/main.ts'],
    {
      cwd: root,
      env: { ...process.env, STUDIO_HOME: join(home, 'data'), STUDIO_PORT: String(port) },
      stdio: 'ignore',
    },
  );
  try {
    await waitForServer();
    await page.goto(`${base}/#/p/${projectId}/overview`);
    await page.getByRole('heading', { name: 'Mini site' }).waitFor();
    await page.getByText('Tokens built', { exact: true }).waitFor();
    await page.screenshot({ path: join(shots, '8-overview-after-restart.png') });
    ok('After a server restart, the project, run and built tokens are all still there');

    // 9. Second project is isolated
    await page.goto(base);
    await page.getByRole('button', { name: 'New project' }).click();
    await page.getByLabel('Name').fill('Second');
    await page.getByRole('button', { name: 'Create project' }).click();
    await page.getByRole('link', { name: 'Add a source' }).waitFor();
    await page.screenshot({ path: join(shots, '10-empty-project-canvas.png') });
    await page.getByRole('link', { name: 'Foundations' }).click();
    await page.getByRole('heading', { name: 'No tokens yet' }).waitFor();
    ok('A second project starts empty: no runs or tokens leak between projects');
    await page.goto(base);
    await page.locator('.project-card').nth(1).waitFor();
    await page.screenshot({ path: join(shots, '9-projects.png') });
  } finally {
    again.kill('SIGTERM');
  }

  if (consoleErrors.length) throw new Error(`Browser console errors:\n${consoleErrors.join('\n')}`);
  ok('No errors in the browser console');
  console.log(`\n${checks.length} checks passed. Screenshots in .cache/studio-smoke/`);
} catch (e) {
  exitCode = 1;
  console.error('\nStudio smoke test FAILED:', e instanceof Error ? e.message : e);
  console.error(serverLog.slice(-3000));
} finally {
  await browser.close();
  if (!server.killed) server.kill('SIGTERM');
  rmSync(home, { recursive: true, force: true });
  process.exit(exitCode);
}
