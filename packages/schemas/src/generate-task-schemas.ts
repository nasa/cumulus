#!/usr/bin/env node

import fs, { FileHandle } from 'fs/promises';
import path from 'path';
import { templateJsonSchemaWithFiles } from './generate-schemas';
import generateTypes from './generate-types';

const queueGranulesFilesJsonSchema = require('../preSyncedFiles.schema.json');

const TYPESCRIPT_OPTION = '--typescript';
function parseOptions(taskDirectory: string, args: string[]): { tsFile?: Promise<FileHandle> } {
  let tsFile;

  if (args.includes(TYPESCRIPT_OPTION)) {
    const position = args.indexOf(TYPESCRIPT_OPTION);
    if (args.length <= position + 1) {
      throw new Error('Missing filepath for typescript option');
    }
    tsFile = fs.open(path.join(taskDirectory, args[position + 1]), 'w');
  }
  return { tsFile };
}

async function runFilesCommand(taskDirectory: string, rawOptions: string[], replacements?: any): Promise<void> {
  const taskSchemasDirectory = path.join(taskDirectory, 'schemas');
  const options = parseOptions(taskDirectory, rawOptions);
  const schemaFiles = await fs.readdir(taskSchemasDirectory);
  schemaFiles.filter((filename) => filename.endsWith('.template'))
    .forEach(
      (schemaTemplateFile) => {
        const inputFile = path.join(taskSchemasDirectory, schemaTemplateFile);
        const outputFile = path.join(
          taskSchemasDirectory,
          schemaTemplateFile.replace('.template', '')
        );
        templateJsonSchemaWithFiles(inputFile, outputFile, replacements);
      }
    );
  if (options.tsFile) {
    const outputFile = await options.tsFile;
    await generateTypes(taskSchemasDirectory, outputFile);
  }
}

async function main() {
  const taskDirectory = process.argv[2];
  const command = process.argv[3];
  const options = process.argv.slice(4);

  switch (command) {
    case 'files':
      await runFilesCommand(taskDirectory, options);
      return;
    case 'queueGranulesFiles':
      await runFilesCommand(taskDirectory, options, queueGranulesFilesJsonSchema)
      return;
    default:
      console.error('Unknown command');
  }
}

main();
