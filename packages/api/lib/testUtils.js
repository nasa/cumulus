'use strict';

const cloneDeep = require('lodash.clonedeep');
const { randomString } = require('@cumulus/common/test-utils');
const { aws: { lambda } } = require('@cumulus/common');
const { User } = require('../models');

/**
 * Add a user that can be authenticated against
 *
 * @param {Object} params - params
 * @param {User} params.userDbClient - an instance of the Users model
 * @returns {Promise<Object>} - an object containing a userName and a password
 */
async function createFakeUser({ userDbClient }) {
  // Create the user and token for this request
  const userName = randomString();
  const password = randomString();

  await userDbClient.create([
    {
      userName,
      password,
      expires: Date.now() + (60 * 60 * 1000) // Token expires in 1 hour
    }
  ]);

  return { userName, password };
}

/**
 * Call the Cumulus API by invoking the Lambda function that backs the API
 * Gateway endpoint.
 *
 * Intended for use with integration tests.  Will invoke the function in AWS
 * Lambda.  This function will handle authorization of the request.
 *
 * @param {Object} params - params
 * @param {string} params.prefix - the prefix configured for the stack
 * @param {string} params.functionName - the name of the Lambda function that
 *   backs the API Gateway endpoint.  Does not include the stack prefix in the
 *   name.
 * @param {string} params.payload - the payload to send to the Lambda function.
 *   See https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html#api-gateway-simple-proxy-for-lambda-input-format
 * @returns {Promise<Object>} - the parsed payload of the response.  See
 *   https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html#api-gateway-simple-proxy-for-lambda-output-format
 */
async function callCumulusApi({ prefix, functionName, payload: userPayload }) {
  const payload = cloneDeep(userPayload);

  const userDbClient = new User(`${prefix}-UsersTable`);

  const { userName, password } = await createFakeUser({ userDbClient });

  // Add authorization header to the request
  payload.headers = payload.headers || {};
  payload.headers.Authorization = `Bearer ${password}`;

  let apiOutput;
  try {
    apiOutput = await lambda().invoke({
      Payload: JSON.stringify(payload),
      FunctionName: `${prefix}-${functionName}`,
    }).promise();
  }
  finally {
    // Delete the user created for this request
    await userDbClient.delete({ userName });
  }

  return JSON.parse(apiOutput.Payload);
}

/**
 * Fetch a granule from the Cumulus API
 *
 * @param {Object} params - params
 * @param {string} params.prefix - the prefix configured for the stack
 * @param {string} params.granuleId - a granule ID
 * @returns {Promise<Object>} - the granule fetched by the API
 */
async function getGranule({ prefix, granuleId }) {
  const payload = await callCumulusApi({
    prefix: prefix,
    functionName: 'ApiGranulesDefault',
    payload: {
      httpMethod: 'GET',
      resource: '/granules/{granuleName}',
      path: `/granules/${granuleId}`,
      pathParameters: {
        granuleName: granuleId
      }
    }
  });

  return JSON.parse(payload.body);
}

/**
 * mocks the context object of the lambda function with
 * succeed and fail functions to facilitate testing of
 * lambda functions used as backend in ApiGateway
 *
 * Intended for use with unit tests.  Will invoke the function locally.
 *
 * @param {Function} endpoint - the lambda function used as ApiGateway backend
 * @param {Object} event - aws lambda event object
 * @param {Function} testCallback - aws lambda callback function
 * @returns {Promise<Object>} the promise returned by the lambda function
 */
function testEndpoint(endpoint, event, testCallback) {
  return new Promise((resolve, reject) => {
    endpoint(event, {
      succeed: (response) => resolve(testCallback(response)),
      fail: (e) => reject(e)
    });
  });
}

/**
 * Generates fake files for a granule
 *
 * @param {string} bucket - a bucket name
 * @returns {Object} a file record
 */
function fakeFilesFactory(bucket) {
  const key = randomString();
  const name = randomString();
  const filepath = `${key}/${name}`;
  const filename = `s3://${bucket}/${filepath}`;
  return {
    bucket,
    name,
    filepath,
    filename
  };
}

/**
 * creates fake granule records
 *
 * @param {string} status - granule status (default to completed)
 * @returns {Object} fake granule object
 */
function fakeGranuleFactory(status = 'completed') {
  return {
    granuleId: randomString(),
    collectionId: 'fakeCollection___v1',
    status,
    execution: randomString(),
    createdAt: Date.now(),
    published: true,
    cmrLink: 'example.com',
    productVolume: 100
  };
}

/**
 * creates fake rule record
 *
 * @param {string} state - rule state (default to DISABLED)
 * @returns {Object} fake rule object
 */
function fakeRuleFactory(state = 'DISABLED') {
  return {
    name: randomString(),
    workflow: randomString(),
    provider: randomString(),
    collection: {
      name: randomString(),
      version: '0.0.0'
    },
    rule: {
      type: 'onetime'
    },
    state
  };
}

/**
 * creates fake pdr records
 *
 * @param {string} status - pdr status (default to completed)
 * @returns {Object} fake pdr object
 */
function fakePdrFactory(status = 'completed') {
  return {
    pdrName: randomString(),
    collectionId: 'fakeCollection___v1',
    provider: 'fakeProvider',
    status,
    createdAt: Date.now()
  };
}

/**
 * creates fake execution records
 *
 * @param {string} status - pdr status (default to completed)
 * @param {string} type - workflow type (default to fakeWorkflow)
 * @returns {Object} fake execution object
 */
function fakeExecutionFactory(status = 'completed', type = 'fakeWorkflow') {
  return {
    arn: randomString(),
    name: randomString(),
    status,
    createdAt: Date.now(),
    type
  };
}

/**
 * creates fake collection records
 *
 * @returns {Object} fake pdr object
 */
function fakeCollectionFactory() {
  return {
    name: randomString(),
    version: '0.0.0',
    provider_path: '/',
    duplicateHandling: 'replace',
    granuleId: '^MOD09GQ\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}$',
    granuleIdExtraction: '(MOD09GQ\\.(.*))\\.hdf',
    sampleFileName: 'MOD09GQ.A2017025.h21v00.006.2017034065104.hdf',
    files: []
  };
}

module.exports = {
  callCumulusApi,
  getGranule,
  testEndpoint,
  fakeGranuleFactory,
  fakePdrFactory,
  fakeCollectionFactory,
  fakeExecutionFactory,
  fakeRuleFactory,
  fakeFilesFactory
};
