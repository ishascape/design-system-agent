import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Button } from './Button.tsx';
import { BUTTON_VARIANTS } from './variants.ts';

const FIGMA = 'https://www.figma.com/design/wCnc6RXvuK5ZuwanC1epne/Ai-Design-system-agent?node-id=3-19';

const meta = {
  title: 'Components/Button',
  component: Button,
  args: { children: 'Explore my work', variant: 'outline', onClick: fn() },
  argTypes: {
    variant: { control: 'inline-radio', options: [...BUTTON_VARIANTS] },
    icon: { control: 'text' },
  },
  parameters: {
    docs: {
      description: {
        component: [
          'An action or navigation link. Renders `<a>` when `href` is set, otherwise `<button type="button">`.',
          '',
          `**Figma:** [Button component set](${FIGMA}) · **Spec:** \`registry/components/button.json\` · **Agent docs:** \`docs/agents/components/button.md\``,
          '',
          '**Source:** ashnidave.com `src/styles/global.css:148-202` at `e072889`. Status: pending approval.',
        ].join('\n'),
      },
    },
  },
} satisfies Meta<typeof Button>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Outline: Story = {};

export const Primary: Story = { args: { variant: 'primary' } };

export const AsLinkWithIcon: Story = {
  name: 'As a link, with icon',
  args: { variant: 'primary', href: '#work', icon: '↓', children: 'Explore my work' },
};

export const Disabled: Story = {
  args: { disabled: true, children: 'Copy email' },
  parameters: {
    docs: { description: { story: 'Not in the source site. Added by design decision (Ashni, 2026-11-02).' } },
  },
};

export const LongLabel: Story = {
  args: { children: 'A long label that has to wrap on narrow screens instead of overflowing' },
  decorators: [(Story) => <div style={{ maxWidth: 240 }}>{Story()}</div>],
};

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
      <Button>Copy email</Button>
      <Button variant="primary" href="#work" icon="↓">
        Explore my work
      </Button>
      <Button disabled>Disabled</Button>
    </div>
  ),
};

/** Interaction test: runs in the docs site and in CI. */
export const KeyboardActivation: Story = {
  args: { children: 'Copy email' },
  play: async ({ args, canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: 'Copy email' });
    await userEvent.tab();
    await expect(button).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await expect(args.onClick).toHaveBeenCalledTimes(1);
  },
};
