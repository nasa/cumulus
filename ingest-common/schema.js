// Contains helper functions for validating JSON against some of the ingest schemas.

const fs = require('fs');
const Ajv = require('ajv');
const ajv = new Ajv();
const local = require('./local-helpers');

const readSchema = (name) => {
  const location = `${local.fileRoot()}/docs/schemas/${name}`;
  const contents = fs.readFileSync(location, 'UTF-8');
  return JSON.parse(contents);
};

const commonSchema = readSchema('ingest_common_schema.json');
const collectionSchema = readSchema('collections_config_schema.json');
const messageSchema = readSchema('message_schema.json');

const compiledCommon = ajv.compile(commonSchema);

/**
 * Validates the collection configuration object passed to it. Returns true or false. If invalid it
 * will have a errors attribute on the function with the list of errors.
 */
exports.validateCollectionsConfiguration =
  ajv.compile(collectionSchema,
    { schemas: { 'ingest_common_schema.json': compiledCommon.schema },
      allErrors: true });

/**
 * Validates the message against the JSON schema. Returns true or false. If invalid it
 * will have a errors attribute on the function with the list of errors.
 */
exports.validateMessageEnvelope =
  ajv.compile(messageSchema,
    { schemas: { 'ingest_common_schema.json': compiledCommon.schema },
      allErrors: true });
