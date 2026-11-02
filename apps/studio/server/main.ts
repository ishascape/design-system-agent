/**
 * Starts the Design System Studio on this computer only (127.0.0.1).
 *
 *   npm run studio            builds the interface if needed, then serves http://localhost:4310
 *
 * Data lives in STUDIO_HOME (default: <repo>/.studio): studio.db plus one folder per project.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Store } from './db.ts';
import { createApp } from './app.ts';
import { Engine } from './workflow/engine.ts';
import { designSystemWorkflow } from './workflow/design-system.ts';

const repoRoot = resolve(import.meta.dirname, '../../..');
const home = resolve(process.env.STUDIO_HOME ?? join(repoRoot, '.studio'));
const port = Number(process.env.STUDIO_PORT ?? 4310);
mkdirSync(join(home, 'projects'), { recursive: true });

const store = new Store(join(home, 'studio.db'));
const interrupted = store.markInterrupted();
const workflows = { [designSystemWorkflow.id]: designSystemWorkflow };
const projectDir = (projectId: string) => {
  if (!/^prj_[0-9a-f]{16}$/.test(projectId)) throw new Error('Invalid project id');
  const d = join(home, 'projects', projectId);
  mkdirSync(d, { recursive: true });
  return d;
};
const engine = new Engine(store, workflows, projectDir);
const app = createApp({ store, engine, workflows, projectDir, allowedHosts: ['localhost', '127.0.0.1'] });

const webDist = resolve(import.meta.dirname, '../dist-web');
if (existsSync(webDist)) {
  const root = relative(process.cwd(), webDist) || '.';
  app.use('/*', serveStatic({ root }));
  app.get('*', serveStatic({ root, path: 'index.html' }));
} else {
  app.get('/', (c) => c.text('The interface is not built yet. Run: npm run studio'));
}

serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, () => {
  console.log(`Design System Studio is running at http://localhost:${port}`);
  console.log(`Data folder: ${home}`);
  if (interrupted)
    console.log(`${interrupted} step(s) were interrupted by the last shutdown; retry them from the workflow.`);
});
