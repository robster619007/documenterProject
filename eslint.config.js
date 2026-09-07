import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import astro from 'eslint-plugin-astro';
import jsxA11y from 'eslint-plugin-jsx-a11y';

export default tseslint.config(
  {
    ignores: [
      'dist/',
      '.astro/',
      'node_modules/',
      'playwright-report/',
      'test-results/',
      '.lighthouseci/',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Lints .astro files, including their embedded a11y rules.
  ...astro.configs.recommended,
  ...astro.configs['jsx-a11y-recommended'],
  // Apply jsx-a11y to React island (.tsx/.jsx) files as well.
  {
    files: ['**/*.{jsx,tsx}'],
    plugins: { 'jsx-a11y': jsxA11y },
    rules: jsxA11y.flatConfigs.recommended.rules,
  },
  // Node tooling files (build scripts, config) run in Node, not the browser.
  // They are plain JS (not TS), so no-undef applies — give them Node globals.
  {
    files: ['**/*.cjs', '**/*.mjs', 'scripts/**/*.js'],
    languageOptions: {
      globals: {
        process: 'readonly',
        module: 'writable',
        require: 'readonly',
        console: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        Buffer: 'readonly',
      },
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
);
