import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode, type Ref } from 'react';

import type { ButtonVariant } from './variants.ts';

interface ButtonBaseProps {
  /**
   * `outline` is the default action style. `primary` is for the single most important action
   * in a view. Source: `.button` and `.button--primary` on ashnidave.com.
   */
  variant?: ButtonVariant;
  /** The visible label. Keep it short and start with a verb, e.g. "Explore my work". */
  children: ReactNode;
  /**
   * Optional icon after the label, such as an arrow. Decorative: it is hidden from screen readers,
   * so the label must make sense on its own.
   */
  icon?: ReactNode;
}

/** Renders a `<button>`. Defaults to `type="button"` so it never submits a form by accident. */
export type ButtonAsButtonProps = ButtonBaseProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
    /** Leave unset to render a `<button>`. */
    href?: undefined;
  };

/**
 * Renders an `<a>` when `href` is set. Links cannot be disabled, so `disabled` is not accepted:
 * remove the link or render a button instead.
 */
export type ButtonAsLinkProps = ButtonBaseProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'children'> & {
    /** Destination URL. Setting it renders a link (`<a>`). */
    href: string;
    /** Not allowed on links: links cannot be disabled. */
    disabled?: never;
  };

export type ButtonProps = ButtonAsButtonProps | ButtonAsLinkProps;

function classes(variant: ButtonVariant, extra: string | undefined): string {
  return ['ds-button', variant === 'primary' && 'ds-button--primary', extra].filter(Boolean).join(' ');
}

function content(children: ReactNode, icon: ReactNode) {
  return (
    <>
      <span className="ds-button__label">{children}</span>
      {icon != null && (
        <span className="ds-button__icon" aria-hidden="true">
          {icon}
        </span>
      )}
    </>
  );
}

/**
 * An action or a navigation link with the ashnidave look: an ink outline (or ink fill for
 * `primary`) that turns marker blue on hover, with registration corner marks on hover and focus.
 *
 * - With `href` it renders a link (`<a>`); without, a `<button type="button">`.
 * - Keyboard: Tab to focus, Enter (and Space for buttons) to activate. Native elements are used,
 *   so no extra key handling is needed.
 * - Never nest it inside another link or button. To make a whole card clickable, make the card
 *   the link and use a non-interactive label inside it.
 */
export const Button = forwardRef<HTMLButtonElement | HTMLAnchorElement, ButtonProps>(function Button(props, ref) {
  if (props.href !== undefined) {
    const { variant = 'outline', children, icon, className, ...rest } = props;
    return (
      <a ref={ref as Ref<HTMLAnchorElement>} className={classes(variant, className)} {...rest}>
        {content(children, icon)}
      </a>
    );
  }
  const { variant = 'outline', children, icon, className, type = 'button', ...rest } = props;
  return (
    <button ref={ref as Ref<HTMLButtonElement>} type={type} className={classes(variant, className)} {...rest}>
      {content(children, icon)}
    </button>
  );
});
