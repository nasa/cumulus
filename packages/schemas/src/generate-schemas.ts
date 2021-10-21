import fs from 'fs';

const parse = require('json-templates');
const filesJsonSchema = require('./files.schema.json');

type SchemaReplacements = {
  [key: string]: unknown
};

function templateJsonSchema(
  schemaTemplatePath: string,
  schemaOutputPath: string,
  replacements: SchemaReplacements
) {
  const schemaTemplateString = fs.readFileSync(schemaTemplatePath, 'utf-8');
  const schemaTemplate = JSON.parse(schemaTemplateString);

  const template = parse(schemaTemplate);

  const schemaOutputString = JSON.stringify(template(replacements), undefined, 2);
  fs.writeFileSync(schemaOutputPath, schemaOutputString);
}

function templateJsonSchemaWithFiles(
  schemaTemplatePath: string,
  schemaOutputPath: string
) {
  templateJsonSchema(
    schemaTemplatePath,
    schemaOutputPath,
    { files: filesJsonSchema }
  );
}

module.exports = {
  templateJsonSchema,
  templateJsonSchemaWithFiles,
};
