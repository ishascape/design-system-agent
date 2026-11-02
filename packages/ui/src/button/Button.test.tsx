// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import axe from 'axe-core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRef } from 'react';
import { scanHardCoded } from '@dsa/discovery';
import { Button } from './Button.tsx';
import { BUTTON_VARIANTS } from './variants.ts';

afterEach(cleanup);

async function axeViolations(container: HTMLElement) {
  const result = await axe.run(container, { rules: { region: { enabled: false } } });
  return result.violations.map((v) => `${v.id}: ${v.help}`);
}

describe('Button', () => {
  it('renders a native button with type="button" by default', () => {
    render(<Button>Copy email</Button>);
    const btn = screen.getByRole('button', { name: 'Copy email' });
    expect(btn.tagName).toBe('BUTTON');
    expect(btn).toHaveProperty('type', 'button');
    expect(btn.className).toBe('ds-button');
  });

  it('allows type="submit" when asked', () => {
    render(<Button type="submit">Send</Button>);
    expect(screen.getByRole('button')).toHaveProperty('type', 'submit');
  });

  it('renders a link when href is set, keeping link semantics', () => {
    render(
      <Button href="/resume.pdf" target="_blank" rel="noreferrer">
        View resume
      </Button>,
    );
    const link = screen.getByRole('link', { name: 'View resume' });
    expect(link.getAttribute('href')).toBe('/resume.pdf');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it.each(BUTTON_VARIANTS)('applies the %s variant class', (variant) => {
    render(<Button variant={variant}>Go</Button>);
    const cls = screen.getByRole('button').className;
    expect(cls.includes('ds-button--primary')).toBe(variant === 'primary');
  });

  it('keeps the icon out of the accessible name', () => {
    render(
      <Button href="#work" variant="primary" icon="↓">
        Explore my work
      </Button>,
    );
    expect(screen.getByRole('link', { name: 'Explore my work' })).toBeTruthy();
  });

  it('activates with mouse, Enter and Space', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<Button onClick={onClick}>Copy email</Button>);
    await user.click(screen.getByRole('button'));
    await user.tab();
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole('button'));
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(3);
  });

  it('does not fire when disabled and is skipped by Tab', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <Button disabled onClick={onClick}>
        Copy email
      </Button>,
    );
    await user.click(screen.getByRole('button'));
    await user.tab();
    expect(onClick).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.body);
  });

  it('forwards refs to the rendered element', () => {
    const ref = createRef<HTMLButtonElement | HTMLAnchorElement>();
    render(<Button ref={ref}>Go</Button>);
    expect(ref.current?.tagName).toBe('BUTTON');
  });

  it('merges a custom className', () => {
    render(<Button className="contact__copy">Copy</Button>);
    expect(screen.getByRole('button').className).toBe('ds-button contact__copy');
  });

  it('has no axe violations as a button, a link and with long text', async () => {
    const { container } = render(
      <div>
        <Button>Copy email</Button>
        <Button href="#work" variant="primary" icon="↓">
          Explore my work
        </Button>
        <Button>{'A very long label that should wrap rather than overflow its container '.repeat(3)}</Button>
      </div>,
    );
    expect(await axeViolations(container)).toEqual([]);
  });

  it('uses token variables only for colours in its stylesheet', () => {
    // Tests run from the repo root (see vitest.config.ts); jsdom rewrites import.meta.url, so use a root path.
    const css = readFileSync(join(process.cwd(), 'packages/ui/src/button/button.css'), 'utf8');
    const hardCodedColours = scanHardCoded([{ path: 'button.css', content: css }], []).filter(
      (h) => h.kind === 'color',
    );
    expect(hardCodedColours).toEqual([]);
  });
});
