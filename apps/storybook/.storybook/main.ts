import type { StorybookConfig } from '@storybook/react-vite';

/**
 * The docs site. Component stories live next to each component (packages/ui/src/**),
 * docs pages (overview, foundations, accessibility, changelog) live in apps/storybook/src.
 */
const config: StorybookConfig = {
  framework: { name: '@storybook/react-vite', options: {} },
  stories: ['../src/**/*.mdx', '../src/**/*.stories.tsx', '../../../packages/ui/src/**/*.stories.tsx'],
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y'],
  core: { disableTelemetry: true },
};
export default config;
