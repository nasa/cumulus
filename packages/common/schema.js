// Contains helper functions for validating JSON against some of the ingest schemas.

const Ajv = require('ajv');
const ajv = new Ajv();
const commonSchema = require('@cumulus/test-data/schemas/ingest_common_schema.json');
const collectionSchema = require('@cumulus/test-data/schemas/collections_config_schema.json');
const messageSchema = require('@cumulus/test-data/schemas/message_schema.json');

const local = require('./local-helpers');
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
