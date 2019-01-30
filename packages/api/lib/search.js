'use strict';

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
      next = `${next}__cumuluskey__${nextObj[context.tableRange.name]}` 
    }
  }
  return next
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
async function determinePage({ query, page, limit, context }) {
  if ((page - limit) <= 0) {
    page = 1
  }

  if (page > 1) {
    // this is a legacy feature
    // we keep iterating through the record until we reach
    // the first record
    const offset = limit * (page - 1);
    const firstRecord = await context.dynamodbDocClient.scan({
      TableName: context.tableName,
      Limit: offset,
      Select: 'COUNT'
    }).promise();

    query.next = composeNext({
      nextObj: firstRecord.LastEvaluatedKey,
      context
    })
  }

  return query
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

    params.ExclusiveStartKey = {
      [context.tableHash.name]: hash,
      [context.tableRange.name]: key
    };
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
    params.ExpressionAttributeNames = { [`#${context.tableHash.name}`]: context.tableHash.name }; 
    params.FilterExpression = `begins_with(#${context.tableHash.name}, :${context.tableHash.name})`;
    params.ExpressionAttributeValues = { [`:${context.tableHash.name}`]: query.prefix };
  }
  return params;
}

/**
 * Performs search operations on a DynamoDB table using scan requests
 * This function is replicating the search functions that were previously
 * performed by ElastiSearch
 *
 * @param {Object} params - input parameters
 * @param {Object} params.query - the express's query parameter object
 * @param {Object} params.context - The context of an instance of the Manager Base class
 * @returns {Promise<Object>} returns the search results 
 */
async function search({ query, context }) {
  // extract query parameters supported by the search
  let order = DESC;
  const sortBy = query.sort_by || 'timestamp';
  let page = parseInt((query.page) ? query.page : 1, 10);
  const limit = parseInt((query.limit) ? query.limit : 10);

  let params = {
    TableName: context.tableName,
    Limit: limit
  };

  // determine the start point for the dynamoDB scan query
  query = await determinePage({ query, page, limit, context });
  params = determineExclusiveStartKey({ query, context, params });

  // handle the fields parameter which limits which fields
  // are returned by the API
  if (query.fields) {
    params.AttributesToGet = query.fields.split(',');
  }

  // apply prefix search filters to the dynamodb request
  // if prefix search is request all other search parameters are ignored
  params = constructPrefixSearch({ query, params, context });

  const scan = await context.dynamodbDocClient.scan(params).promise()

  // determine whether this is an ascending or descending order sort
  // and sort the results
  if (query.order !== 'desc') {
    order = ASC;
  }
  const results = sort(scan.Items, [sortBy], order)

  const response = {
    meta: {
      name: 'cumulus-api',
      stack: process.env.stackName,
      table: context.tableName,
      limit,
      page,
      count: scan.ScannedCount,
      next: composeNext({ nextObj: scan.LastEvaluatedKey, context }),
    },
    results  
  }
  return response
}

module.exports = {
  search
}
