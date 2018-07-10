/* eslint-disable no-param-reassign */

'use strict';

const has = require('lodash.has');
const omit = require('lodash.omit');

const aws = require('@cumulus/common/aws');

// regular expression against query string field to determine the query operation
const regexes = {
  terms: /^(.*)__in$/,
  term: /^((?!__).)*$/,
  not_in: /^(.*)__not_in$/,
  not: /^(.*)__not$/,
  exists: /^(.*)__exists$/,
  range: /^(.*)__(from|to)$/
};

// reserved query string fields which are not attributes for query
const reserved = [
  'limit', //
  'page', // not supported
  'skip', // ?
  'sort_by', // not supported for scan, supported for query
  'order', // not supported for scan, supported for query
  'prefix', // not supported
  'fields'
];

/**
 * add filter expression to search parameters
 *
 * @param {Object} queries - search parameters
 * @param {string} fieldName - field name to search against
 * @param {string} operation - search operation
 * @param {Array} values - field values for the operation
 * @returns {Object} search parameters
 */
function addFilterExpression(queries, fieldName, operation, values) {
  if (!queries.ExpressionAttributeValues) queries.ExpressionAttributeValues = {};
  if (!queries.ExpressionAttributeNames) queries.ExpressionAttributeNames = {};

  const numberOfValues = Object.keys(queries.ExpressionAttributeValues).length;

  let filter;
  const attributeName = `#${fieldName}`;

  switch (operation) {
  case 'IN':
  case 'NOT_IN': {
    // array holds attributeValue tokens
    const attributeValueArray = [];

    for (let i = 0; i < values.length; i += 1) {
      const attributeValue = `:value${numberOfValues + i}`;
      attributeValueArray.push(attributeValue);
      queries.ExpressionAttributeValues[attributeValue] = values[i];
    }

    // filter will be: #attribute IN (:value0, :value1,...)
    filter = `${attributeName} ${operation} (${attributeValueArray.join(', ')})`;
    if (operation === 'NOT_IN') {
      filter = `NOT (${attributeName} IN (${attributeValueArray.join(', ')}))`;
    }

    break;
  }
  case '=':
  case '!=':
  case '>=':
  case '<=': {
    const attributeValue = `:value${numberOfValues}`;
    filter = `${attributeName} ${operation} ${attributeValue}`;
    queries.ExpressionAttributeValues[attributeValue] = values;
    break;
  }
  case 'attribute_exists':
  case 'attribute_not_exists': {
    filter = `${operation} (${attributeName})`;
    break;
  }
  default:
    break;
  }

  if (filter) {
    queries.FilterExpression = (queries.FilterExpression) ?
      [queries.FilterExpression, filter].join(' AND ') : filter;
  }

  queries.ExpressionAttributeNames[attributeName] = fieldName;

  return queries;
}

/**
 * add filter expression to search parameters
 *
 * @param {Object} queries - search parameters
 * @param {string} fields - field values for the operation
 * @returns {Object} search parameters
 */
function addProjectionExpression(queries, fields) {
  if (!queries.ExpressionAttributeNames) queries.ExpressionAttributeNames = {};

  const fieldsArray = fields.replace(/ /g, '').split(',');
  const attributeNames = [];
  fieldsArray.forEach((fieldName) => {
    const attributeName = `#${fieldName}`;
    attributeNames.push(attributeName);
    queries.ExpressionAttributeNames[attributeName] = fieldName;
  });
  queries.ProjectionExpression = attributeNames.join(', ');
  return queries;
}

/**
 * operations for building search parameters
 */
const build = {
  term: (queries, params) => params.map((i) => addFilterExpression(queries, i.name, '=', i.value)),

  range: (queries, params, regex) => {
    // extract field names and values
    params.forEach((i) => {
      const match = i.name.match(regex);
      if (match[2] === 'from') {
        addFilterExpression(queries, match[1], '>=', i.value);
      }

      if (match[2] === 'to') {
        addFilterExpression(queries, match[1], '<=', i.value);
      }
    });
  },

  terms: (queries, params, regex) => {
    params.forEach((i) => {
      const field = i.name.match(regex)[1];
      const values = i.value.replace(' ', '').split(',');
      addFilterExpression(queries, field, 'IN', values);
    });
  },

  not_in: (queries, params, regex) => {
    params.forEach((i) => {
      const field = i.name.match(regex)[1];
      const values = i.value.replace(' ', '').split(',');
      addFilterExpression(queries, field, 'NOT_IN', values);
    });
  },

  not: (queries, params) => params.map((i) => addFilterExpression(queries, i.name, '!=', i.value)),

  exists: (queries, params, regex) => {
    params.forEach((i) => {
      const field = i.name.match(regex)[1];
      const operation = (i.value === 'true') ? 'attribute_exists' : 'attribute_not_exists';
      addFilterExpression(queries, field, operation);
    });
  }
};

/**
 * select all the parameters which matches the given regular expression
 *
 * @param {map} fields - query parameters
 * @param {string} regex - regular expression
 * @returns {map} query parameters matching the regular expression
 */
function selectParams(fields, regex) {
  return fields.filter((f) => {
    const match = f.name.match(regex);
    if (match) return true;
    return false;
  });
}

/**
 * build database search parameters from query constraints
 *
 * @param {Object} queryParams - query parameters from user
 * @returns {Object} search parameters for searching database
 */
function buildSearch(queryParams) {
  const queries = {};

  // remove reserved words (that are not fields)
  const params = omit(queryParams, reserved);

  // determine which search strategy should be applied
  // options are term, terms, range, exists and not in
  const fields = Object.keys(params).map((k) => ({ name: k, value: params[k] }));

  Object.keys(regexes).forEach((k) => {
    const f = selectParams(fields, regexes[k]);

    if (f) {
      build[k](queries, f, regexes[k]);
    }
  });

  if (has(queryParams, 'fields')) addProjectionExpression(queries, queryParams.fields);

  return queries;
}

module.exports = buildSearch;

process.env.GranulesTable = 'jl-test-integration-GranulesTable';
const queryStringParameters = {
  status__not_in: 'failed',
  collectionId__in: 'MYD13Q1___006, MOD09GQ___006',
  collectionId: 'MYD13Q1___006',
  timeToPreprocess__from: 4.218,
  timeToPreprocess__to: 17.044,
  fields: 'granuleId, timeToPreprocess, createdAt'
};

const params = buildSearch(queryStringParameters);
params.TableName = process.env.GranulesTable;
console.log(params);
const dynamodbDocClient = aws.dynamodbDocClient({ convertEmptyValues: true });
async function test() {
  const resp = await dynamodbDocClient.scan(params).promise();
  console.log(resp);
}

test();
