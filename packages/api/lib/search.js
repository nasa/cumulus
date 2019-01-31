'use strict';

const omit = require('lodash.omit');
const clonedeep = require('lodash.clonedeep');
const { default: sort, ASC, DESC } = require('sort-array-objects');

/**
 * creates the next string for pagination using table hash and range
 * values
 *
 * @param {Object} params - input parameters
 * @param {Object} params.nextObject - DynamoDBs LastEvaluatedKey object
 * @param {Object} params.context - The context of an instance of the Manager Base class
 * @returns {string} the next pagination string
 */
function composeNext({ nextObj, context }) {
  let next = null;
  if (nextObj) {
    next = nextObj[context.tableHash.name];
    if (context.tableRange) {
      next = `${next}__cumuluskey__${nextObj[context.tableRange.name]}`;
    }
  }
  return next;
}

/**
 * Determines the next string value based on the provided page and limit values
 *
 * @param {Object} params - input parameters
 * @param {Object} params.query - the express's query parameter object
 * @param {integer} params.page - the page value
 * @param {integer} params.limit - the limit value defaults to 1
 * @param {Object} params.context - The context of an instance of the Manager Base class
 * @returns {Promise<Object>} returns an updated query object
 */
async function determinePage({
  query, page, limit, context
}) {
  let localPage = page;
  const newQuery = clonedeep(query);
  if ((localPage - limit) <= 0) {
    localPage = 1;
  }

  if (localPage > 1) {
    // this is a legacy feature
    // we keep iterating through the record until we reach
    // the first record
    const offset = limit * (localPage - 1);
    const firstRecord = await context.dynamodbDocClient.scan({
      TableName: context.tableName,
      Limit: offset,
      Select: 'COUNT'
    }).promise();

    newQuery.next = composeNext({
      nextObj: firstRecord.LastEvaluatedKey,
      context
    });
  }

  return newQuery;
}

/**
 * Determines the ExeclusiveStartkey for a scan request
 *
 * @param {Object} params - input parameters
 * @param {Object} params.query - the express's query parameter object
 * @param {Object} params.context - The context of an instance of the Manager Base class
 * @param {Object} params.params - The parameter object passed to DynamoDB scan query
 * @returns {Object} returns an updated parameter object
 */
function determineExclusiveStartKey({ query, context, params }) {
  if (query.next) {
    const [hash, key] = query.next.split('__cumuluskey__');

    if (context.tableHash.name && !hash) {
      throw new Error(`The ${context.tableHash.name} is missing in the prev/next query`);
    }
    if (context.tableRange && context.tableRange.name && !key) {
      throw new Error(`The range (key) ${context.tableRange.name} is missing in the prev/next query`);
    }
    const updatedParams = clonedeep(params);

    updatedParams.ExclusiveStartKey = {
      [context.tableHash.name]: hash,
      [context.tableRange.name]: key
    };
    return updatedParams;
  }

  return params;
}

/**
 * Construct a filters for a prefix search
 *
 * @param {Object} params - input parameters
 * @param {Object} params.query - the express's query parameter object
 * @param {Object} params.params - The parameter object passed to DynamoDB scan query
 * @param {Object} params.context - The context of an instance of the Manager Base class
 * @returns {Object} returns an updated parameter object
 */
function constructPrefixSearch({ query, params, context }) {
  if (query.prefix) {
    const updatedParams = clonedeep(params);
    updatedParams.ExpressionAttributeNames = { [`#${context.tableHash.name}`]: context.tableHash.name };
    updatedParams.FilterExpression = `begins_with(#${context.tableHash.name}, :${context.tableHash.name})`;
    updatedParams.ExpressionAttributeValues = { [`:${context.tableHash.name}`]: query.prefix };
    return updatedParams;
  }
  return params;
}

const regexes = {
  terms: /^(.*)__in$/,
  term: /^((?!__).)*$/,
  not: /^(.*)__not$/,
  exists: /^(.*)__exists$/,
  range_from: /^(.*)__from$/,
  range_to: /^(.*)__to$/
};

/**
 * constructs a dynamoDB filter expression based on a given
 * query parameter field
 *
 * @param {Object} params - input parameters
 * @param {string} params.field - the filed name (e.g. granuleId)
 * @param {string} params.regex - the type of the request (coming from the regexes object above)
 * @returns {string} the filter expression
 */
function constructFilterExpression({ field, regex }) {
  if (regex === 'not') {
    return `#${field} <> :${field}`;
  }
  if (regex === 'range_from') {
    return `#${field} >= :${field}`;
  }
  if (regex === 'range_to') {
    return `#${field} <= :${field}`;
  }
  return `#${field} = :${field}`;
}

/**
 * Constructs the dynamodb filter parameters for given search queries
 *
 * @param {Object} params - input parameters
 * @param {Object} params.query - the express's query parameter object
 * @param {Object} params.params - The parameter object passed to DynamoDB scan query
 * @param {Object} params.context - The context of an instance of the Manager Base class
 * @returns {Object} returns an updated parameter object
 */
function constructSearch({ query, params, context }) {
  let q = clonedeep(query);
  let updatedParams = clonedeep(params);

  // remove reserved words (that are not fields)
  q = omit(
    q,
    [
      'limit',
      'page',
      'skip',
      'sort_by',
      'order',
      'next',
      'fields'
    ]
  );

  // if prefix search is request all other search parameters are ignored
  if (q.prefix) {
    updatedParams = constructPrefixSearch({ query, params: updatedParams, context });
  }
  else if (Object.keys(q).length > 0) {
    // construct attribute names
    updatedParams.ExpressionAttributeNames = {};
    updatedParams.ExpressionAttributeValues = {};
    const filterExpressions = [];
    Object.keys(q).forEach((field) => {
      let fieldName = field;
      let match = field.match(/^(.*)__(in|not|exists|from|to)$/);
      if (match[1]) {
        fieldName = match[1];
      }
      updatedParams.ExpressionAttributeNames[`#${fieldName}`] = fieldName;

      let value = Number(q[field]);
      if (!value) value = q[field];
      updatedParams.ExpressionAttributeValues[`:${fieldName}`] = value;

      const regex = Object.keys(regexes).find((k) => {
        match = field.match(regexes[k]);
        if (match) return true;
        return false;
      });

      filterExpressions.push(constructFilterExpression({ field: fieldName, regex }));
    });
    updatedParams.FilterExpression = filterExpressions.join(' and ');
  }
  return updatedParams;
}

/**
 * Performs search operations on a DynamoDB table using scan requests
 * This function is replicating the search functions that were previously
 * performed by ElasticSearch
 *
 * @param {Object} params - input parameters
 * @param {Object} params.q - the express's query parameter object
 * @param {Object} params.context - The context of an instance of the Manager Base class
 * @returns {Promise<Object>} returns the search results
 */
async function search({ q, context }) {
  // extract query parameters supported by the search
  let order = DESC;
  let query = clonedeep(q);
  const sortBy = query.sort_by || 'timestamp';
  const page = parseInt((query.page) ? query.page : 1, 10);
  const limit = parseInt((query.limit) ? query.limit : 10, 10);

  let params = {
    TableName: context.tableName,
    Limit: limit
  };

  // determine the start point for the dynamoDB scan query
  query = await determinePage({
    query, page, limit, context
  });
  params = determineExclusiveStartKey({ query, context, params });

  // handle the fields parameter which limits which fields
  // are returned by the API
  if (query.fields) {
    params.AttributesToGet = query.fields.split(',');
  }

  // construct the filter search expression
  params = constructSearch({ query, params, context });

  const scan = await context.dynamodbDocClient.scan(params).promise();

  // determine whether this is an ascending or descending order sort
  // and sort the results
  if (query.order !== 'desc') {
    order = ASC;
  }
  const results = sort(scan.Items, [sortBy], order);

  const response = {
    meta: {
      name: 'cumulus-api',
      stack: process.env.stackName,
      table: context.tableName,
      limit,
      page,
      count: scan.ScannedCount,
      next: composeNext({ nextObj: scan.LastEvaluatedKey, context })
    },
    results
  };
  return response;
}

module.exports = {
  search
};
