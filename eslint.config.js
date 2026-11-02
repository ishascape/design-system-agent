import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/**', '.cache/**', 'audits/**', 'tests/fixtures/**'] },
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
    files: ['packages/*/src/cli/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
);
