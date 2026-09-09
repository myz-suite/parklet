import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    // Playwright fixture 要求空解构参数（async ({}, use)），tests 目录放行空对象模式
    files: ['tests/**/*.ts'],
    rules: {
      'no-empty-pattern': 'off',
    },
  },
);
