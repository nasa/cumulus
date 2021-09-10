#!/usr/bin/env node

const fs = require('fs-extra');
const path = require('path');

const {
  templateJsonSchemaWithFiles,
} = require('./generate-schemas');

const taskDirectory = process.argv[2];
const command = process.argv[3];
const taskSchemasDirectory = path.join(taskDirectory, 'schemas');

if (command === 'files') {
  const schemaTemplateFiles = fs.readdirSync(taskSchemasDirectory)
    .filter((filename) => filename.endsWith('.template'));

  schemaTemplateFiles.forEach((schemaTemplateFile) => {
    templateJsonSchemaWithFiles(
      path.join(taskSchemasDirectory, schemaTemplateFile),
      path.join(taskSchemasDirectory, schemaTemplateFile.replace('.template', ''))
    );
  });
}
