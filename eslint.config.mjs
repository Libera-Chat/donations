import neostandard, { resolveIgnoresFromGitignore } from 'neostandard'
import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import { cwd } from 'node:process'

export default [
  ...neostandard({
    ignores: [
      ...resolveIgnoresFromGitignore(),
    ],
    ts: true,
  }),
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['*.mjs'],
        },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
        tsconfigRootDir: cwd(),
      },
    },
  },
  {
    name: 'libera-chat/custom',
    rules: {
      '@typescript-eslint/restrict-template-expressions': ['warn', {
        allowNumber: true,
        allowBoolean: true,
        allowRegExp: true,
        allowAny: true,
      }],
      '@typescript-eslint/no-this-alias': 'off',
      '@typescript-eslint/only-throw-error': ['error', {
        allowThrowingUnknown: true,
      }],
      '@stylistic/comma-dangle': ['warn', {
        arrays: 'always-multiline',
        objects: 'always-multiline',
        imports: 'always-multiline',
        exports: 'always-multiline',
        enums: 'always-multiline',
        functions: 'never',
      }],
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-void': 'off',
      'no-console': 'warn',
    },
  },
  {
    name: 'libera-chat/tests',
    files: ['**/*.test.ts', '**/*.test.js'],
    rules: {
      '@typescript-eslint/ban-ts-comment': ['error', {
        'ts-expect-error': false,
        'ts-ignore': true,
        'ts-nocheck': true,
        'ts-check': false,
        minimumDescriptionLength: 3,
      }],
    },
  },
]
