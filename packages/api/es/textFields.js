'use strict';

const textFields = [
  'type',
  'provider',
  'granuleId',
  'collectionId',
  'pdrName',
  'file',
  'executions',
  'version',
  'name',
  'id',
  'status',
  'operationType',
  'taskArn',
  'execution',
  'address',
  'originalUrl',
  'cmrLink',
  'protocol',
  'host',
  'location',
  'workflow',
  'state',
  'arn',
];

/**
 * For certain Elasticsearch aggregations, it is more efficient for text fields to use
 * the keyword subfield, which is stored in [fieldname].keyword. This function
 * converts that field to use the keyword version if its a text field.
 *
 * @param {string/number} field - elasticsearch field
 * @returns {string} - field converted to the right subfield if eligible
 */
function convertTextField(field) {
  let returnField = field;

  if (textFields.includes(returnField)) {
    returnField = `${returnField}.keyword`;
  }

  return returnField;
}

module.exports = { convertTextField };
