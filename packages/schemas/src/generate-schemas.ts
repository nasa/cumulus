import fs from 'fs';

const parse = require('json-templates');
const filesJsonSchema = require('../files.schema.json');

type SchemaReplacements = {
  [key: string]: unknown
};

/**
 * Dynamically replace contents of a JSON schema template with specified replacements.
 *
 * @param {string} schemaTemplatePath - Input schema template path
 * @param {string} schemaOutputPath - Path to write updated output schema
 * @param {object} replacements
 *   Object map specifying values to replace in schema template
 * @returns {void}
 */
export function templateJsonSchema(
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

/**
 * Generate output JSON schema from template with file properties updated.
 *
 * @param schemaTemplatePath - Input schema template path
 * @param schemaOutputPath   - Path to write updated output schema
 * @param [replacements]     - Optional schema replacement
 * @returns {void}
 */
export function templateJsonSchemaWithFiles(
  schemaTemplatePath: string,
  schemaOutputPath: string,
  altJsonSchema: SchemaReplacements = filesJsonSchema
) {
  const replacements = { files: altJsonSchema };
  templateJsonSchema(
    schemaTemplatePath,
    schemaOutputPath,
    replacements,
  );
}
