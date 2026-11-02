import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { STATUS_LABEL, STATUS_TONE, runLabel, type Status } from '../lib/format.ts';

// ---------- Icons: small inline strokes, so there is no icon-font dependency ----------
const PATHS = {
  projects: 'M3 6.5h6l1.5 2H21v10a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z',
  overview: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z',
  workflows: 'M5 6a2 2 0 1 0 0-.01M19 18a2 2 0 1 0 0-.01M7 6h5a3 3 0 0 1 3 3v6a3 3 0 0 0 3 3',
  foundations:
    'M12 3a9 9 0 1 0 0 18c1 0 1.5-.7 1.5-1.5 0-1.2-1-1.5-1-2.5s.8-1.5 2-1.5H17a4 4 0 0 0 4-4c0-4.7-4-8.5-9-8.5zM7.5 11.5h.01M10 7.5h.01M15 7.5h.01',
  components: 'M12 3l4 4-4 4-4-4zM5 10l4 4-4 4-4-4zM19 10l4 4-4 4-4-4zM12 13l4 4-4 4-4-4z',
  docs: 'M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7',
  changes: 'M6 3v12M6 15a3 3 0 1 0 0 .01M18 9a3 3 0 1 0 0-.01M18 9c0 4-6 3-12 6',
  exports: 'M12 3v12M7 10l5 5 5-5M4 19h16',
  settings:
    'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19 12l2-1-1-3-2 .3-1.3-1.3L17 5l-3-1-1 2h-2l-1-2-3 1 .3 2L6 8.3 4 8l-1 3 2 1v0l-2 1 1 3 2-.3L7.3 17 7 19l3 1 1-2h2l1 2 3-1-.3-2 1.3-1.3 2 .3 1-3z',
  plus: 'M12 5v14M5 12h14',
  play: 'M7 5l12 7-12 7z',
  stop: 'M6 6h12v12H6z',
  retry: 'M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6L6 18',
  pause: 'M8 5v14M16 5v14',
  dot: 'M12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2z',
  alert: 'M12 4l9 16H3zM12 10v4M12 17h.01',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  lock: 'M6 11h12v10H6zM8 11V8a4 4 0 0 1 8 0v3',
  file: 'M6 3h9l4 4v14H6zM14 3v5h5',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  github:
    'M9 19c-4 1.5-4-2-6-2.5M15 21v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1-.3-3.4 1.3a11.6 11.6 0 0 0-6 0C6.8 2.8 5.8 3.1 5.8 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4.4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21',
  globe:
    'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9z',
  figma:
    'M9 3h3v6H9a3 3 0 0 1 0-6zM12 3h3a3 3 0 0 1 0 6h-3zM9 9h3v6H9a3 3 0 0 1 0-6zM15 12a3 3 0 1 0 0 .01M9 15h3v3a3 3 0 1 1-3-3z',
  package: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5',
  chevron: 'M9 6l6 6-6 6',
  back: 'M15 6l-6 6 6 6',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
} as const;
export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

const STATUS_ICON: Record<Status, IconName> = {
  pending: 'dot',
  running: 'dot',
  'awaiting-approval': 'pause',
  succeeded: 'check',
  failed: 'x',
  cancelled: 'stop',
  interrupted: 'alert',
  blocked: 'lock',
  rejected: 'x',
};

export function StatusBadge({
  status,
  compact = false,
  run = false,
}: {
  status: Status;
  compact?: boolean;
  run?: boolean;
}) {
  return (
    <span className={`status status--${STATUS_TONE[status]}${compact ? ' status--compact' : ''}`} data-status={status}>
      {status === 'running' ? (
        <span className="status__pulse" aria-hidden="true" />
      ) : (
        <Icon name={STATUS_ICON[status]} size={12} />
      )}
      <span>{run ? runLabel(status) : STATUS_LABEL[status]}</span>
    </span>
  );
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
export function Button({
  variant = 'secondary',
  icon,
  size = 'md',
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; icon?: IconName; size?: 'sm' | 'md' }) {
  return (
    <button type="button" className={`btn btn--${variant} btn--${size}${className ? ` ${className}` : ''}`} {...rest}>
      {icon && <Icon name={icon} size={size === 'sm' ? 14 : 16} />}
      {children}
    </button>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon: IconName;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty__icon">
        <Icon name={icon} size={22} />
      </div>
      <h2 className="empty__title">{title}</h2>
      {children && <div className="empty__body">{children}</div>}
      {action && <div className="empty__action">{action}</div>}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div className="note note--danger" role="alert">
      <Icon name="alert" size={14} />
      <div>{children}</div>
    </div>
  );
}

/** Modal dialog on the native <dialog> element: focus trap, Escape and backdrop for free. */
export function Dialog({
  open,
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`dialog${wide ? ' dialog--wide' : ''}`}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={onClose}
    >
      {open && (
        <>
          <header className="dialog__head">
            <h2 id={titleId}>{title}</h2>
            <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
              <Icon name="x" />
            </button>
          </header>
          <div className="dialog__body">{children}</div>
          {footer && <footer className="dialog__foot">{footer}</footer>}
        </>
      )}
    </dialog>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id} className="field__label">
        {label}
      </label>
      {children(id)}
      {hint && <div className="field__hint">{hint}</div>}
    </div>
  );
}

export function Facts({ facts }: { facts: { label: string; value: string }[] }) {
  if (!facts.length) return null;
  return (
    <dl className="facts">
      {facts.map((f) => (
        <div key={f.label} className="facts__row">
          <dt>{f.label}</dt>
          <dd>{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="page-head__sub">{subtitle}</p>}
      </div>
      {actions && <div className="page-head__actions">{actions}</div>}
    </header>
  );
}

export const sourceIcon = (kind: string): IconName =>
  kind === 'github' ? 'github' : kind === 'figma' ? 'figma' : kind === 'package' ? 'package' : 'globe';
