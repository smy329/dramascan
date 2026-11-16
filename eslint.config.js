import tseslint from '@typescript-eslint/eslint-plugin';
import parser from '@typescript-eslint/parser';

export default [
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parser,
      parserOptions: {
        project: true,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-unused-expressions': 'error',
      'no-implicit-coercion': ['error', { boolean: false, number: true, string: true }],
      // Prettier always parenthesises multi-line JSX in ternaries and arrow
      // bodies. Keep the rule for genuinely redundant parentheses in plain
      // expressions, but do not fight the formatter on JSX.
      'no-extra-parens': [
        'error',
        'all',
        { ignoreJSX: 'all', enforceForArrowConditionals: false },
      ],
      'no-floating-decimal': 'error',
      'eol-last': 'error',
      'no-trailing-spaces': 'error',
      'consistent-return': 'error',
      'default-case': 'error',
      'no-confusing-arrow': 'error',
      'arrow-body-style': ['error', 'as-needed'],
    },
  },
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
  },
];
