/* eslint no-console: 0 */

'use strict';

const AWS = require('aws-sdk');
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const fs = require('fs');
const https = require('https');
const url = require('url');

function missingEnvironmentVariables() {
  return [
    'asyncOperationId',
    'asyncOperationsTable',
    'lambdaName',
    'payloadUrl'
  ].filter((key) => process.env[key] === undefined);
}

async function fetchPayload() {
  const s3 = new AWS.S3();

  // Download and delete the payload
  const parsedPayloadUrl = url.parse(process.env.payloadUrl);
  const payloadBucket = parsedPayloadUrl.hostname;
  const payloadKey = parsedPayloadUrl.path.substring(1);

  console.log(`Fetching s3://${payloadBucket}/${payloadKey}`);

  let payloadResponse;
  try {
    payloadResponse = await s3.getObject({
      Bucket: payloadBucket,
      Key: payloadKey
    }).promise();
  }
  catch (err) {
    console.error(`Failed to fetch s3://${payloadBucket}/${payloadKey}: ${err.message}`);
    throw err;
  }

  // console.log('stringified payloadResponse in fetchPayload:', JSON.stringify(payloadResponse, null, 2));

  const payload = payloadResponse.Body.toString();

  console.log('payload in fetchPayload:', payload);

  // await s3.deleteObject({
  //   Bucket: payloadBucket,
  //   Key: payloadKey
  // }).promise();

  return JSON.parse(payload);
}

async function getLambdaInfo() {
  const lambda = new AWS.Lambda();

  // Fetch info about the lambda function
  const getFunctionResponse = await lambda.getFunction({
    FunctionName: process.env.lambdaName
  }).promise();

  const handlerId = getFunctionResponse.Configuration.Handler;
  const [moduleFileName, moduleFunctionName] = handlerId.split('.');

  return {
    moduleFileName,
    moduleFunctionName,
    codeUrl: getFunctionResponse.Code.Location
  };
}

async function fetchLambdaFunction(codeUrl) {
  // Download the lambda function
  await new Promise((resolve, reject) => {
    const file = fs.createWriteStream('/home/task/fn.zip');

    file.on('error', reject);
    file.on('finish', () => file.close());
    file.on('close', resolve);

    https.get(codeUrl, (res) => res.pipe(file));
  });

  // Extract the lambda function
  await exec('unzip -o /home/task/fn.zip -d /home/task/lambda-function');
}

function updateAsyncOperation(names, values, expression) {
  const dynamodb = new AWS.DynamoDB();

  return dynamodb.updateItem({
    TableName: process.env.asyncOperationsTable,
    Key: {
      id: { S: process.env.asyncOperationId }
    },
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
    UpdateExpression: expression
  }).promise();
}

function storeOperationSuccess(result) {
  console.log(`AsyncOperation ${process.env.asyncOperationId} succeeded with result: ${JSON.stringify(result)}`); // eslint-disable-line max-len
  return updateAsyncOperation(
    { '#S': 'status', '#R': 'result' },
    { ':s': { S: 'SUCCEEDED' }, ':r': { S: JSON.stringify(result) } },
    'SET #S = :s, #R = :r'
  );
}

function storeOperationFailure(message) {
  console.log(`AsyncOperation ${process.env.asyncOperationId} failed with error: ${message}`);
  return updateAsyncOperation(
    { '#S': 'status', '#E': 'error' },
    { ':s': { S: 'FAILED' }, ':e': { S: message } },
    'SET #S = :s, #E = :e'
  );
}

async function runTask() {
  let lambdaInfo;
  let payload;

  try {
    lambdaInfo = await getLambdaInfo();

    await fetchLambdaFunction(lambdaInfo.codeUrl);

    payload = await fetchPayload();
  }
  catch (err) {
    console.error(err);
    await storeOperationFailure(`AsyncOperation failure: ${err.message}`);
    return;
  }

  try {
    // Load the lambda function
    const task = require(`/home/task/lambda-function/${lambdaInfo.moduleFileName}`); //eslint-disable-line global-require, import/no-dynamic-require, max-len

    // Run the lambda function
    console.log('payload:', payload);
    console.log('stringified payload:', JSON.stringify(payload, null, 2));
    const result = await task[lambdaInfo.moduleFunctionName](payload);

    await storeOperationSuccess(result);
  }
  catch (err) {
    await storeOperationFailure(err.message);
  }
}

// Make sure that all of the required environment variables are set
const missingVars = missingEnvironmentVariables();
if (missingVars.length > 0) {
  console.error('Missing environment variables:', missingVars.join(', '));
}
else runTask();
