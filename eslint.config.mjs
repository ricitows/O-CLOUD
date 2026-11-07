import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import nextPlugin from '@next/eslint-plugin-next';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';

const eslintConfig = [
  { ignores: ['.next/**', '.next-dev/**', '.next-output/**', 'node_modules/**', 'next-env.d.ts'] },
  nextPlugin.flatConfig.recommended,
  {
    files: ['**/*.{js,mjs,ts,tsx}'],
    languageOptions: { parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } } },
    plugins: { '@typescript-eslint': tsPlugin, 'jsx-a11y': jsxA11y, 'react-hooks': reactHooks },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'jsx-a11y/alt-text': 'warn',
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: { parser: tsParser },
  },
];

export default eslintConfig;
