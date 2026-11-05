const { dirname, join } = require('path');
const { existsSync, readFileSync } = require('fs');

const createNodesV2 = [
  'tasks/*/package.json',
  async (files, _options, context) =>
    files.flatMap((file) => {
      const root = dirname(file);
      const pkg = JSON.parse(readFileSync(join(context.workspaceRoot, file), 'utf-8'));
      const usesGenerator = Object.values(pkg.scripts || {})
        .some((s) => s.includes('generate-task-schemas'));
      if (!usesGenerator || !existsSync(join(context.workspaceRoot, root, 'schemas'))) {
        return [];
      }
      return [[file, {
        projects: {
          [root]: {
            targets: {
              schemas: {
                executor: 'nx:run-commands',
                options: {
                  cwd: '{projectRoot}',
                  command: 'rm -rf .generated && mkdir -p .generated && cp -R schemas .generated/ && node ../../packages/schemas/dist/generate-task-schemas.js .generated files',
                },
                dependsOn: [{ projects: ['@cumulus/schemas'], target: 'build' }],
                inputs: [
                  '{projectRoot}/schemas/*.template',
                  '{workspaceRoot}/packages/schemas/files.schema.json',
                  { dependentTasksOutputFiles: '**/generate-task-schemas.js', transitive: false },
                ],
                outputs: ['{projectRoot}/.generated/schemas'],
                cache: true,
              },
            },
          },
        },
      }]];
    }),
];

module.exports = { createNodesV2 };
