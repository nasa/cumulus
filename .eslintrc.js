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
    'plugin:@typescript-eslint/recommended',
    'plugin:@docusaurus/recommended',
    'plugin:eslint-comments/recommended',
    'plugin:import/errors',
    'plugin:import/warnings',
    'plugin:import/typescript',
    'plugin:jsdoc/recommended',
    'plugin:lodash/recommended',
    'plugin:node/recommended',
    'plugin:promise/recommended',
    'plugin:unicorn/recommended',
  ],
  parser: '@babel/eslint-parser',
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
    indent: 'off',
    'object-curly-newline': ['warn', { consistent: true, minProperties: 6 }],
    'require-jsdoc': 'off',

    'jsdoc/check-param-names': 'warn',
    'jsdoc/check-tag-names': 'warn',
    'jsdoc/newline-after-description': 'warn',
    'jsdoc/no-undefined-types': 'off', // We'll rely on tsc for these checks
    'jsdoc/require-hyphen-before-param-description': 'warn',
    'jsdoc/require-param-description': 'off',
    'jsdoc/require-param-name': 'warn',
    'jsdoc/require-param-type': 'warn',
    'jsdoc/require-param': 'warn',
    'jsdoc/require-property-description': 'off',
    'jsdoc/require-returns-description': 'off',
    'jsdoc/require-returns-type': 'warn',

    'generator-star-spacing': 'off',
    'import/no-extraneous-dependencies': 'off',
    "import/extensions": "off",
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
    'no-restricted-syntax': ['error', 'ForInStatement', 'LabeledStatement', 'WithStatement'],
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

    "unicorn/catch-error-name": "warn",
    "unicorn/consistent-function-scoping": "off",
    "unicorn/filename-case": "off",
    "unicorn/no-for-loop": "off",
    "unicorn/no-null": "warn",
    "unicorn/no-process-exit": "off",
    "unicorn/prefer-flat-map": "off",
    "unicorn/prefer-negative-index": "off",
    "unicorn/prefer-module": "off",
    "unicorn/prefer-regexp-test": "off",
    "unicorn/prefer-set-has": "off",
    "unicorn/prefer-spread": "off",
    "unicorn/prefer-string-slice": "off",
    "unicorn/prefer-top-level-await": "off",
    "unicorn/prefer-trim-start-end": "off",
    "unicorn/prevent-abbreviations": "off",
    "unicorn/prefer-node-protocol": "off",
    "unicorn/no-array-callback-reference": "off",
    "unicorn/no-array-push-push": "off",
    "unicorn/no-array-for-each": "off",
    "unicorn/no-useless-undefined": "off",
    "unicorn/text-encoding-identifier-case": "off",
    "unicorn/numeric-separators-style": "off",
    "unicorn/prefer-optional-catch-binding": "off",
    "unicorn/no-useless-spread": "off",
    "unicorn/no-useless-promise-resolve-reject": "off",
    "unicorn/no-new-array": "off",
    "unicorn/no-await-expression-member": "off",
    "unicorn/prefer-array-flat-map": "off",
    "unicorn/prefer-at": "off",
    "unicorn/prefer-ternary": "off",
    "unicorn/prefer-date-now": "off",
    "unicorn/no-negated-condition": "off",
    "unicorn/explicit-length-check": "off",
    "unicorn/prefer-string-replace-all": "off",
    "unicorn/prefer-native-coercion-functions": "off",
    "unicorn/prefer-array-find": "off",
    "unicorn/switch-case-braces": "off",
    "unicorn/import-style": "off",
    "unicorn/no-array-reduce": "off",
    "unicorn/no-lonely-if": "off",
    "unicorn/prefer-object-from-entries": "off",
    "unicorn/prefer-logical-operator-over-ternary": "off",
    "unicorn/prefer-switch": "off",
    "unicorn/prefer-array-some": "off",
    "unicorn/prefer-number-properties": "off",
    "unicorn/no-useless-switch-case": "off",
    "unicorn/no-object-as-default-parameter": "off",
    "unicorn/prefer-string-trim-start-end": "off",
    "unicorn/no-empty-file": "off",
    "unicorn/prefer-event-target": "off",
    "unicorn/prefer-code-point": "off",
    "unicorn/no-static-only-class": "off",
    "unicorn/prefer-includes": "off",
    "unicorn/no-this-assignment": "off",
    "unicorn/error-message": "off",
    "unicorn/empty-brace-spaces": "off",
    "unicorn/no-thenable": "off",
    "unicorn/prefer-array-flat": "off",
    "unicorn/prefer-prototype-methods": "off",

    quotes: "off",
  },
  parserOptions: {
    requireConfigFile: false,
  },
  overrides: [
    {
      files: ['*.ts'],
      parser: '@typescript-eslint/parser',
      plugins: [
        '@typescript-eslint',
      ],
      settings: {
        jsdoc: {
          mode: 'typescript',
        },
      },
      rules: {
        '@typescript-eslint/no-require-imports': 'off',
        '@typescript-eslint/dot-notation': 'off',
        '@typescript-eslint/no-implied-eval': 'off',
        '@typescript-eslint/no-throw-literal': 'off',
        '@typescript-eslint/return-await': 'off',
        'import/no-extraneous-dependencies': 'off',
        'import/prefer-default-export': 'off',
        '@typescript-eslint/lines-between-class-members': 'off',
        'lodash/prefer-lodash-typecheck': 'off',
        'node/no-unsupported-features/es-syntax': 'off',
        'node/shebang': 'off',

        'jsdoc/require-jsdoc': 'off',
        'jsdoc/require-param-type': 'off',
        'jsdoc/require-property-type': 'off',
        'jsdoc/require-returns-type': 'off',
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
        'jsdoc/require-jsdoc': 'off',
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
