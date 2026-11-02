import type { Preview } from '@storybook/react-vite';
import '@dsa/ui/styles.css';
import './preview.css';

const preview: Preview = {
  parameters: {
    layout: 'centered',
    controls: { expanded: true },
    // Fail the a11y panel (and the test runner) on violations instead of only warning.
    a11y: { test: 'error' },
    backgrounds: { disable: true },
  },
  tags: ['autodocs'],
};
export default preview;
