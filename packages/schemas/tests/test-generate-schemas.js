const fs = require('fs-extra');
const test = require('ava');
const path = require('path');

const filesJsonSchema = require('../files.schema.json');
const {
  templateJsonSchema,
  templateJsonSchemaWithFiles,
} = require('../dist/generate-schemas');

test('templateJsonSchema correctly updates schema template', (t) => {
  const schemaTemplatePath = path.join(__dirname, 'fake-schema-template.json');
  const schemaOutputPath = path.join(__dirname, 'fake-schema-output.json');
  t.teardown(async () => {
    await fs.unlink(schemaTemplatePath);
    await fs.unlink(schemaOutputPath);
  });
  fs.writeFileSync(
    schemaTemplatePath,
    JSON.stringify({
      foo: '{{ foo }}',
    })
  );
  const replacements = {
    foo: 'bar',
  };
  templateJsonSchema(
    schemaTemplatePath,
    schemaOutputPath,
    replacements
  );
  const schemaOutput = fs.readFileSync(schemaOutputPath, 'utf-8');
  t.deepEqual(schemaOutput, JSON.stringify({ foo: 'bar' }, undefined, 2));
});

test('templateJsonSchemaWithFiles correctly inserts file schema to template', (t) => {
  const schemaTemplatePath = path.join(__dirname, 'fake-task-schema-template.json');
  const schemaOutputPath = path.join(__dirname, 'fake-task-schema-output.json');
  t.teardown(async () => {
    await fs.unlink(schemaTemplatePath);
    await fs.unlink(schemaOutputPath);
  });
  fs.writeFileSync(
    schemaTemplatePath,
    JSON.stringify({
      files: '{{files}}',
    })
  );
  templateJsonSchemaWithFiles(
    schemaTemplatePath,
    schemaOutputPath
  );
  const schemaOutput = fs.readFileSync(schemaOutputPath, 'utf-8');
  t.deepEqual(schemaOutput, JSON.stringify({ files: filesJsonSchema }, undefined, 2));
});
