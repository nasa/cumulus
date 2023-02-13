'use strict';

const path = require('path');
const { readFileSync } = require('fs');

const loadRootPackageJson = () => {
  const rootPackageJsonFilename = path.join(__dirname, 'package.json');

  const rawRootPackageJson = readFileSync(rootPackageJsonFilename, 'utf8');

  return JSON.parse(rawRootPackageJson);
};

const getRootDependencies = () => {
  const rootPackageJson = loadRootPackageJson();

  if (rootPackageJson.dependencies) {
    return Object.keys(rootPackageJson.dependencies);
  }

  return [];
};

const getRootDevDependencies = () => {
  const rootPackageJson = loadRootPackageJson();

  if (rootPackageJson.devDependencies) {
    return Object.keys(rootPackageJson.devDependencies);
  }

  return [];
};

module.exports = {
  plugins: [
    'eslint-comments',
    'import',
    'jsdoc',
    'lodash',
    'node',
    'promise',
    'unicorn',
  ],
  extends: [
    'airbnb-base',
    'plugin:@docusaurus/recommended',
    'plugin:eslint-comments/recommended',
    'plugin:import/errors',
    'plugin:import/warnings',
    'plugin:import/typescript',
    'plugin:lodash/recommended',
    'plugin:node/recommended',
    'plugin:promise/recommended',
    'plugin:unicorn/recommended',
  ],
  parser: 'babel-eslint',
  env: {
    jasmine: true,
    node: true,
    es2020: true,
  },
  globals: {
    JSX: true,
  },
  rules: {
    'import/no-unresolved': [
      2,
      { ignore: ['^@theme', '^@docusaurus', '^@generated'] },
    ],
    complexity: ['error', 15],
    indent: ['error', 2],
    'object-curly-newline': ['warn', { consistent: true, minProperties: 6 }],
    'require-jsdoc': 'off',
    'valid-jsdoc': [
      'warn',
      {
        prefer: {
          arg: 'param',
          return: 'returns',
        },
        preferType: {
          Boolean: 'boolean',
          Number: 'number',
          String: 'string',
          object: 'Object',
          array: 'Array',
          date: 'Date',
          regexp: 'RegExp',
          Regexp: 'RegExp',
          promise: 'Promise',
        },
        requireParamDescription: false,
        requireParamType: true,
        requireReturn: false,
        requireReturnDescription: false,
        requireReturnType: true,
      },
    ],
    'jsdoc/check-param-names': 'warn',
    'jsdoc/check-tag-names': 'warn',
    'jsdoc/check-types': 'off',
    'jsdoc/newline-after-description': 'off',
    'jsdoc/require-description-complete-sentence': 'off',
    'jsdoc/require-example': 'off',
    'jsdoc/require-hyphen-before-param-description': 'off',
    'jsdoc/require-param': 'off',
    'jsdoc/require-param-description': 'off',
    'jsdoc/require-param-name': 'warn',
    'jsdoc/require-param-type': 'off',
    'jsdoc/require-returns-description': 'off',
    'jsdoc/require-returns-type': 'off',

    'generator-star-spacing': 'off',
    'import/no-extraneous-dependencies': 'off',
    'import/newline-after-import': 'off',
    'class-methods-use-this': 'off',
    'no-warning-comments': 'off',
    'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'no-useless-escape': 'off',
    'no-console': 'warn',
    'unicorn/no-fn-reference-in-iterator': 'off',
    'spaced-comment': 'off',
    'require-yield': 'off',
    'require-await': 'error',
    'no-return-await': 'off',
    'prefer-template': 'warn',
    'no-underscore-dangle': 'off',
    'comma-dangle': [
      'error',
      {
        arrays: 'always-multiline',
        objects: 'always-multiline',
        imports: 'always-multiline',
        exports: 'always-multiline',
        functions: 'never',
      },
    ],
    strict: 'off',
    'guard-for-in': 'off',
    'object-shorthand': 'off',
    'space-before-function-paren': [
      'error',
      {
        anonymous: 'always',
        named: 'never',
        asyncArrow: 'always',
      },
    ],
    'brace-style': [2, '1tbs'],
    'max-classes-per-file': 'warn',
    'max-len': [
      2,
      {
        code: 100,
        ignorePattern: '(https?:|JSON\\.parse|[Uu]rl =)',
        ignoreStrings: true,
        ignoreTemplateLiterals: true,
      },
    ],
    'arrow-parens': ['error', 'always'],
    'prefer-destructuring': 'off',
    'function-paren-newline': ['error', 'consistent'],
    'implicit-arrow-linebreak': 'off',
    'operator-linebreak': ['warn', 'before'],

    'eslint-comments/no-unused-disable': 'warn',
    'eslint-comments/disable-enable-pair': [
      'error',
      { allowWholeFile: true },
    ],

    'lodash/import-scope': ['error', 'method'],
    'lodash/prefer-constant': 'off',
    'lodash/prefer-lodash-method': 'off',

    'node/no-missing-require': 'off',

    'unicorn/catch-error-name': 'warn',
    'unicorn/consistent-function-scoping': 'off',
    'unicorn/filename-case': 'off',
    'unicorn/no-for-loop': 'off',
    'unicorn/no-null': 'warn',
    'unicorn/no-process-exit': 'off',
    'unicorn/prefer-flat-map': 'off',
    'unicorn/prefer-negative-index': 'off',
    'unicorn/prefer-set-has': 'off',
    'unicorn/prefer-spread': 'off',
    'unicorn/prefer-string-slice': 'off',
    'unicorn/prefer-trim-start-end': 'off',
    'unicorn/prevent-abbreviations': 'off',
  },
  overrides: [
    {
      files: ['*.ts'],
      parser: '@typescript-eslint/parser',
      plugins: [
        '@typescript-eslint',
      ],
      extends: ['airbnb-typescript/lib/shared'],
      rules: {
        '@typescript-eslint/no-implied-eval': 'off',
        '@typescript-eslint/no-throw-literal': 'off',
        '@typescript-eslint/comma-dangle': [
          'error',
          {
            arrays: 'always-multiline',
            objects: 'always-multiline',
            imports: 'always-multiline',
            exports: 'always-multiline',
            functions: 'never',
          },
        ],
        '@typescript-eslint/return-await': 'off',
        'import/no-extraneous-dependencies': 'off',
        'import/prefer-default-export': 'off',
        '@typescript-eslint/lines-between-class-members': 'off',
        'lodash/prefer-lodash-typecheck': 'off',
        'node/no-unsupported-features/es-syntax': 'off',
        'node/shebang': 'off',
      },
      parserOptions: {
        project: './tsconfig.eslint.json',
      },
    },
    {
      files: [
        '**/bin/**/*.js',
        '**/spec/**/*.js',
        'packages/api/migrations/**/*.js',
        'packages/deployment/**/*.js',
        'tf-modules/internal/cumulus-test-cleanup/**/*.js',
      ],
      rules: { 'no-console': 'off' },
    },
    {
      files: [
        '**/test/**/*.js',
        '**/tests/**/*.js',
        '**/tests/**/*.ts',
        'example/spec/**/*.js',
      ],
      rules: {
        'max-classes-per-file': 'off',
        'no-console': 'off',
        'no-new': 'off',
        'no-param-reassign': 'off',
        'node/no-extraneous-require': [
          'error',
          {
            allowModules: [
              ...getRootDependencies(),
              ...getRootDevDependencies(),
            ],
          },
        ],
      },
    },
    {
      files: ['packages/db/src/migration-template.ts'],
      rules: {
        '@typescript-eslint/no-unused-vars': 'off',
      },
    },
    {
      files: ['website/src/pages/*.tsx'],
      rules: {
        'no-unused-vars': 'off',
        'node/no-unsupported-features/es-syntax': 'off',
      },
    },
  ],
};
