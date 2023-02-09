'use strict';

const { lambda } = require('@cumulus/aws-client/services');

/**
 * Retrieve a rule's Kinesis Event Source Mappings
 *
 * @param {Object} uuid - unique identifier for a rule
 * @returns {Promise<Object>} - details about an Event Source Mapping
 */
async function getEventSourceMapping(uuid) {
  return await lambda().getEventSourceMapping({ UUID: uuid }).promise();
}

/**
 * Delete a rule's Kinesis Event Source Mappings
 *
 * @param {Object} uuid - unique identifier for a rule
 * @returns {Promise<Object>}
 */
async function deleteEventSourceMapping(uuid) {
  return await lambda().deleteEventSourceMapping({ UUID: uuid }).promise();
}

/**
 * Recursively gets all pages for an AWS Lambda Aliases/Version object query
 *
 * @param {Object} config - A AWS Lambda query configuration object
 * @param {string} key - Name of the object type being queried.  'Versions' or 'Aliases'
 * @param {Object} listFunction - The paginated AWS function we want to get all 'pages' from
 * @returns {Promise.Object[]} Returns a concatenated list of all the objects
 *                             returned from this page and every page following.
 */
async function getAllPages(config, key, listFunction) {
  const page = await listFunction(config).promise();
  if (!page.NextMarker) return page[key];

  const pages = page[key];

  return pages.concat(
    await getAllPages(
      { ...config, Marker: page.NextMarker },
      key,
      listFunction.promise()
    )
  );
}

/**
 * Takes a lambda function name and returns all aliases for that function
 *
 * See: https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/Lambda.html#listAliases-property
 *
 * @param {string} lambdaFunctionName - The name of a lambda function
 * @returns {Promise.Object[]} returns the promise of a list of AWS Lambda Alias objects
 */
async function getLambdaAliases(lambdaFunctionName) {
  const config = {
    MaxItems: 10000,
    FunctionName: lambdaFunctionName,
  };
  return await getAllPages(config, 'Aliases', lambda().listAliases.bind(lambda()));
}

/**
 * Takes a lambda function name and returns all versions for that function
 *
 * See: https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/Lambda.html#listVersionsByFunction-property
 *
 * @param {string} lambdaFunctionName - The name of a lambda function
 * @returns {Promise.Object[]} returns the promise of a list of AWS Lambda Version objects
 */
async function getLambdaVersions(lambdaFunctionName) {
  const config = { FunctionName: lambdaFunctionName };
  return await getAllPages(config, 'Versions',
    lambda().listVersionsByFunction.bind(lambda()));
}

module.exports = {
  deleteEventSourceMapping,
  getLambdaAliases,
  getLambdaVersions,
  getEventSourceMapping,
};
