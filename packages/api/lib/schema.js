'use strict';

const Ajv = require('ajv');
const cloneDeep = require('lodash/cloneDeep');

const recordIsValid = (incomingRecord, schema, removeAdditional = false) => {
  // Protect against AVJ mutating item, regardless of config options
  const record = cloneDeep(incomingRecord);

  if (!schema) {
    throw new Error('schema is not defined');
  }

  const schemaWithAdditionalPropertiesProhibited = JSON.parse(
    JSON.stringify(
      schema,
      (_, value) => {
        if (value.type === 'object') {
          return {
            additionalProperties: false,
            ...value,
          };
        }

        return value;
      }
    )
  );

  const ajv = new Ajv({
    removeAdditional,
    useDefaults: true,
    v5: true,
  });
  const validate = ajv.compile(schemaWithAdditionalPropertiesProhibited);
  const valid = validate(record);
  if (!valid) {
    const err = new Error(`The record has validation errors: ${JSON.stringify(validate.errors)}`);
    err.name = 'SchemaValidationError';
    err.detail = JSON.stringify(validate.errors);
    throw err;
  }
};

exports.recordIsValid = recordIsValid;
