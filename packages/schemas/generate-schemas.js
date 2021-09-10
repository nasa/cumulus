const fs = require('fs-extra');
const parse = require('json-templates');
const filesJsonSchema = require('./files.schema.json');

function templateJsonSchema(
  schemaTemplatePath,
  schemaOutputPath,
  replacements
) {
  const schemaTemplateString = fs.readFileSync(schemaTemplatePath, 'utf-8');
  const schemaTemplate = JSON.parse(schemaTemplateString);

  const template = parse(schemaTemplate);

  const schemaOutputString = JSON.stringify(template(replacements));
  fs.writeFileSync(schemaOutputPath, schemaOutputString);
}

function templateJsonSchemaWithFiles(
  schemaTemplatePath,
  schemaOutputPath
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
