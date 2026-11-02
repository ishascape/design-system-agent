import { api } from './lib/api.ts';
import { useLoad, useProjectEvents, useRoute } from './lib/hooks.ts';
import { Sidebar } from './components/Sidebar.tsx';
import { EmptyState, ErrorNote } from './components/ui.tsx';
import { ProjectsPage } from './pages/Projects.tsx';
import { OverviewPage } from './pages/Overview.tsx';
import { WorkflowsPage } from './pages/Workflows.tsx';
import { FoundationsPage } from './pages/Foundations.tsx';
import { ComponentsPage } from './pages/Components.tsx';
import { DocumentationPage } from './pages/Documentation.tsx';
import { ChangesPage } from './pages/Changes.tsx';
import { ExportsPage } from './pages/Exports.tsx';
import { SettingsPage } from './pages/Settings.tsx';

export function App() {
  const route = useRoute();
  const pid = route.projectId;
  const { version, live } = useProjectEvents(pid);
  const project = useLoad(() => (pid ? api.project(pid) : Promise.resolve(undefined)), [pid, version]);
  const workflows = useLoad(() => api.workflows(), []);

  let body;
  if (!pid) body = <ProjectsPage />;
  else if (project.error && !project.data) {
    body = (
      <EmptyState
        icon="alert"
        title="This project could not be opened"
        action={
          <a className="btn btn--secondary btn--md" href="#/">
            Back to projects
          </a>
        }
      >
        <ErrorNote>{project.error}</ErrorNote>
      </EmptyState>
    );
  } else if (!project.data || !workflows.data)
    body = (
      <div className="loading" aria-busy="true">
        Loading project…
      </div>
    );
  else {
    const p = project.data;
    const wf = workflows.data[0]!;
    const props = { project: p, version, workflow: wf };
    body =
      route.page === 'workflows' ? (
        <WorkflowsPage {...props} runId={route.runId} />
      ) : route.page === 'foundations' ? (
        <FoundationsPage {...props} />
      ) : route.page === 'components' ? (
        <ComponentsPage {...props} />
      ) : route.page === 'documentation' ? (
        <DocumentationPage {...props} />
      ) : route.page === 'changes' ? (
        <ChangesPage {...props} />
      ) : route.page === 'exports' ? (
        <ExportsPage {...props} />
      ) : route.page === 'settings' ? (
        <SettingsPage {...props} />
      ) : (
        <OverviewPage {...props} />
      );
  }

  return (
    <div className="shell">
      <Sidebar route={route} project={project.data} live={live} />
      <main className={`main${route.page === 'workflows' ? ' main--canvas' : ''}`}>{body}</main>
    </div>
  );
}
