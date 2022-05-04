'use strict';

const Ajv = require('ajv');

const recordIsValid = (item, schema, removeAdditional = false) => {
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
  const valid = validate(item);
  if (!valid) {
    const err = new Error(`The record has validation errors: ${JSON.stringify(validate.errors)}`);
    err.name = 'SchemaValidationError';
    err.detail = JSON.stringify(validate.errors);
    throw err;
  }
};

exports.recordIsValid = recordIsValid;
