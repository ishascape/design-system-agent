import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.{ts,tsx}', 'tests/**/*.test.ts'],
    // Component tests opt into jsdom with a `// @vitest-environment jsdom` comment.
  },
});
