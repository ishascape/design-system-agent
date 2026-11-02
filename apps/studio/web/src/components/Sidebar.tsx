import { href, type LiveState, type Route } from '../lib/hooks.ts';
import type { ProjectDetail } from '../lib/api.ts';
import { Icon, StatusBadge, type IconName } from './ui.tsx';

const NAV: { page: Route['page']; label: string; icon: IconName }[] = [
  { page: 'overview', label: 'Overview', icon: 'overview' },
  { page: 'workflows', label: 'Workflows', icon: 'workflows' },
  { page: 'foundations', label: 'Foundations', icon: 'foundations' },
  { page: 'components', label: 'Components', icon: 'components' },
  { page: 'documentation', label: 'Documentation', icon: 'docs' },
  { page: 'changes', label: 'Changes', icon: 'changes' },
  { page: 'exports', label: 'Exports', icon: 'exports' },
  { page: 'settings', label: 'Settings', icon: 'settings' },
];

export function Sidebar({
  route,
  project,
  live,
}: {
  route: Route;
  project: ProjectDetail | undefined;
  live: LiveState;
}) {
  const pid = route.projectId;
  const activeRun = project?.runs.find((r) => r.id === project.activeRunId);
  return (
    <nav className="sidebar" aria-label="Studio">
      <div className="sidebar__brand">
        <span className="sidebar__mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span>Design System Studio</span>
      </div>

      <a
        className={`nav-item${route.page === 'projects' ? ' is-active' : ''}`}
        href="#/"
        aria-current={route.page === 'projects' ? 'page' : undefined}
      >
        <Icon name="projects" />
        <span>Projects</span>
      </a>

      {pid && (
        <div className="sidebar__project">
          <div className="sidebar__project-name" title={project?.name}>
            {project?.name ?? '…'}
          </div>
          {activeRun && (
            <a className="sidebar__run" href={href({ page: 'workflows', projectId: pid, runId: activeRun.id })}>
              <span>Run {activeRun.number}</span>
              <StatusBadge status={activeRun.status} compact run />
            </a>
          )}
          <ul className="sidebar__nav">
            {NAV.map((n) => {
              const active = route.page === n.page;
              return (
                <li key={n.page}>
                  <a
                    className={`nav-item${active ? ' is-active' : ''}`}
                    href={href({ page: n.page, projectId: pid })}
                    aria-current={active ? 'page' : undefined}
                  >
                    <Icon name={n.icon} />
                    <span>{n.label}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="sidebar__foot">
        {pid && (
          <span
            className={`live is-${live}`}
            title={
              live === 'live' ? 'Receiving live updates from the Studio server' : 'Not receiving live updates right now'
            }
          >
            <span className="live__dot" aria-hidden="true" />
            {live === 'live' ? 'Live' : live === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
          </span>
        )}
        <span className="sidebar__local">Runs on this computer only</span>
      </div>
    </nav>
  );
}
