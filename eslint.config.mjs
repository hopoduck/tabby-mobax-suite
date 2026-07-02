import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // `.claude` holds git worktrees (working copies with their own tsconfig/eslint config);
  // never lint them from the main checkout — they'd otherwise add candidate tsconfig roots.
  { ignores: ['dist', 'build', 'node_modules', 'coverage', '.claude'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Pin the tsconfig root to this checkout so a worktree's copy isn't treated as a
    // second candidate root ("multiple candidate TSConfigRootDirs are present").
    languageOptions: {
      parserOptions: { tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // `_`-prefixed identifiers signal intentionally-unused (e.g. Angular DI-only params).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // CommonJS Node build scripts (webpack config, scripts/*) — allow require()/module/__dirname
    // plus the Node runtime globals these scripts touch (process/console).
    files: ['**/*.cjs', 'webpack.config.js', 'scripts/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'writable',
        __dirname: 'readonly',
        process: 'readonly',
        console: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
