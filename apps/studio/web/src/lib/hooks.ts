import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

// ---------- Routing (hash based, so the server needs no route config) ----------
export interface Route {
  page:
    | 'projects'
    | 'overview'
    | 'workflows'
    | 'foundations'
    | 'components'
    | 'documentation'
    | 'changes'
    | 'exports'
    | 'settings';
  projectId?: string;
  runId?: string;
}
const subscribeHash = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};
export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'p' && parts[1]) {
    const page = (parts[2] ?? 'overview') as Route['page'];
    return { page, projectId: parts[1], ...(parts[3] ? { runId: parts[3] } : {}) };
  }
  return { page: 'projects' };
}
export const href = (r: Route) => (r.projectId ? `#/p/${r.projectId}/${r.page}${r.runId ? `/${r.runId}` : ''}` : '#/');
export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash);
  return parseRoute(hash);
}
export const navigate = (r: Route) => {
  window.location.hash = href(r);
};

// ---------- Data loading ----------
export interface Loaded<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  reload: () => void;
}
/** Loads data and reloads whenever any of `deps` change (including the live-update counter). */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]): Loaded<T> {
  const [state, setState] = useState<{ data: T | undefined; error: string | null; loading: boolean }>({
    data: undefined,
    error: null,
    loading: true,
  });
  const [nonce, setNonce] = useState(0);
  const seq = useRef(0);
  useEffect(() => {
    const mine = ++seq.current;
    setState((s) => ({ ...s, loading: true }));
    load().then(
      (data) => mine === seq.current && setState({ data, error: null, loading: false }),
      (e: unknown) =>
        mine === seq.current &&
        setState((s) => ({ ...s, error: e instanceof Error ? e.message : String(e), loading: false })),
    );
  }, [...deps, nonce]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}

/**
 * Subscribes to the project's server events. Returns a counter that increases on every change,
 * so pages can pass it to useLoad and refetch real state. No timers fake progress.
 */
export type LiveState = 'connecting' | 'live' | 'reconnecting';
export function useProjectEvents(projectId: string | undefined): { version: number; live: LiveState } {
  const [version, setVersion] = useState(0);
  const [live, setLive] = useState<LiveState>('connecting');
  useEffect(() => {
    if (!projectId) return;
    setLive('connecting');
    const es = new EventSource(`/api/projects/${projectId}/events`);
    let pending = false;
    const bump = () => {
      // Coalesce bursts of log events into one refetch per frame.
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        setVersion((v) => v + 1);
      });
    };
    es.addEventListener('ready', () => {
      // Also refetch on (re)connect, so state missed while disconnected is picked up.
      setLive('live');
      bump();
    });
    es.addEventListener('change', bump);
    es.onerror = () => setLive('reconnecting');
    return () => es.close();
  }, [projectId]);
  return { version, live };
}

/** Re-renders every second while `active`, for live durations of running steps. */
export function useTicker(active: boolean) {
  const [, setT] = useState(0);
  useEffect(() => {
    if (!active) return;
    const i = setInterval(() => setT((t) => t + 1), 1000);
    return () => clearInterval(i);
  }, [active]);
}
