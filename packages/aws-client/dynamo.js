const awsServices = require('./services');

/**
 * Create a DynamoDB table and then wait for the table to exist
 *
 * @param {Object} params - the same params that you would pass to AWS.createTable
 *   See https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/DynamoDB.html#createTable-property
 * @returns {Promise<Object>} - the output of the createTable call
 */
async function createAndWaitForDynamoDbTable(params) {
  const createTableResult = await awsServices.dynamodb().createTable(params).promise();
  await awsServices.dynamodb().waitFor('tableExists', { TableName: params.TableName }).promise();

  return createTableResult;
}
exports.createAndWaitForDynamoDbTable = createAndWaitForDynamoDbTable;
