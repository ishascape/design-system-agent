import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'apps/studio/dist-web/**',
      'node_modules/**',
      '.cache/**',
      'audits/**',
      'tests/fixtures/**',
      'storybook-static/**',
      'packages/tokens/dist/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    rules: {
      'no-console': ['error', { allow: ['error', 'warn'] }],
      // With noUncheckedIndexedAccess, regex capture groups are typed as possibly undefined even
      // after a successful match. `m[1]!` there is correct and clearer than extra branches.
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    // Command-line tools and browser checks report progress on stdout.
    files: [
      'packages/*/src/cli/**/*.ts',
      'apps/studio/server/main.ts',
      'tests/docs/**/*.ts',
      'tests/parity/**/*.ts',
      'tests/studio/**/*.ts',
    ],
    rules: { 'no-console': 'off' },
  },
);
