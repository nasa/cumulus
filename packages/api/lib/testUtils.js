'use strict';

const fs = require('fs');
const { randomString, randomId } = require('@cumulus/common/test-utils');
const { sqs } = require('@cumulus/aws-client/services');
const { putJsonS3Object } = require('@cumulus/aws-client/S3');
const { createJwtToken } = require('./token');
const { authorizedOAuthUsersKey } = require('../app/auth');

const isLocalApi = () => process.env.CUMULUS_ENV === 'local';

const dataDir = 'app/data';
const getWorkflowList = () => fs.readdirSync(dataDir).map((f) => JSON.parse(fs.readFileSync(`${dataDir}/${f}`).toString()));

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

function fakeFileFactory(params = {}) {
  const fileName = randomId('name');

  return {
    bucket: randomString(),
    fileName,
    key: fileName,
    ...params
  };
}

/**
 * Returns a fake Granule record
 *
 * @param {string} status - granule status (default to completed)
 * @returns {Object} fake granule object
 */
function fakeGranuleFactory(status = 'completed') {
  return {
    granuleId: randomId('granule'),
    dataType: randomId('datatype'),
    version: randomId('vers'),
    collectionId: 'fakeCollection___v1',
    status,
    execution: randomString(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    published: true,
    cmrLink: 'example.com',
    productVolume: 100
  };
}

/**
 * Returns a fake Granule record
 *
 * @param {Object} options - properties to set on the granule
 * @returns {Object} fake granule object
 */
function fakeGranuleFactoryV2(options = {}) {
  return Object.assign(
    fakeGranuleFactory(),
    options
  );
}

/**
 * Create a fake rule record
 *
 * @param {Object} params - overrides
 * @returns {Object} fake rule object
 */
function fakeRuleFactoryV2(params = {}) {
  const rule = {
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
    state: 'DISABLED'
  };

  return { ...rule, ...params };
}

/**
 * creates fake rule record
 *
 * @param {string} state - rule state (default to DISABLED)
 * @returns {Object} fake rule object
 */
function fakeRuleFactory(state = 'DISABLED') {
  return fakeRuleFactoryV2({ state });
}

/**
 * creates fake pdr records
 *
 * @param {string} status - pdr status (default to completed)
 * @returns {Object} fake pdr object
 */
function fakePdrFactory(status = 'completed') {
  return {
    pdrName: randomId('pdr'),
    collectionId: 'fakeCollection___v1',
    provider: 'fakeProvider',
    status,
    createdAt: Date.now()
  };
}

/**
 * creates fake pdr records
 *
 * @param {Object} params - overrides
 * @returns {Object} fake pdr object
 */
function fakePdrFactoryV2(params = {}) {
  const pdr = {
    pdrName: randomId('pdr'),
    collectionId: 'fakeCollection___v1',
    provider: 'fakeProvider',
    status: 'completed',
    createdAt: Date.now()
  };

  return { ...pdr, ...params };
}

/**
 * creates fake execution records
 *
 * @param {Object} params - overrides
 * @returns {Object} fake execution object
 */
function fakeExecutionFactoryV2(params = {}) {
  const execution = {
    arn: randomString(),
    duration: 180.5,
    name: randomString(),
    execution: randomString(),
    parentArn: randomString(),
    error: { test: 'error' },
    status: 'completed',
    createdAt: Date.now() - 180.5 * 1000,
    updatedAt: Date.now(),
    timestamp: Date.now(),
    type: 'fakeWorkflow',
    originalPayload: { testInput: 'originalPayloadValue' },
    finalPayload: { testOutput: 'finalPayloadValue' },
    tasks: {}
  };

  return { ...execution, ...params };
}

/**
 * creates fake execution records
 *
 * @param {string} status - pdr status (default to completed)
 * @param {string} type - workflow type (default to fakeWorkflow)
 * @returns {Object} fake execution object
 */
function fakeExecutionFactory(status = 'completed', type = 'fakeWorkflow') {
  return fakeExecutionFactoryV2({ status, type });
}

/**
 * creates fake collection records
 *
 * @param {Object} options - properties to set on the collection
 * @returns {Object} fake collection object
 */
function fakeCollectionFactory(options = {}) {
  return Object.assign(
    {
      name: randomString(),
      dataType: randomString(),
      version: '0.0.0',
      provider_path: '',
      duplicateHandling: 'replace',
      granuleId: '^MOD09GQ\\.A[\\d]{7}\\.[\\S]{6}\\.006\\.[\\d]{13}$',
      granuleIdExtraction: '(MOD09GQ\\.(.*))\\.hdf',
      sampleFileName: 'MOD09GQ.A2017025.h21v00.006.2017034065104.hdf',
      files: []
    },
    options
  );
}

/**
 * creates fake provider records
 *
 * @param {Object} options - properties to set on the provider
 * @returns {Object} fake provider object
 */
function fakeProviderFactory(options = {}) {
  return Object.assign(
    {
      id: randomString(),
      globalConnectionLimit: 1,
      protocol: 'http',
      host: randomString(),
      port: 80
    },
    options
  );
}

function fakeAccessTokenFactory(params = {}) {
  return {
    accessToken: randomId('accessToken'),
    refreshToken: randomId('refreshToken'),
    username: randomId('username'),
    expirationTime: Date.now() + (60 * 60 * 1000),
    ...params
  };
}

const setAuthorizedOAuthUsers = (users) =>
  putJsonS3Object(process.env.system_bucket, authorizedOAuthUsersKey(), users);

async function createFakeJwtAuthToken({ accessTokenModel, username }) {
  const {
    accessToken,
    refreshToken,
    expirationTime
  } = fakeAccessTokenFactory();
  await accessTokenModel.create({ accessToken, refreshToken });

  return createJwtToken({ accessToken, expirationTime, username });
}

/**
 * create a dead-letter queue and a source queue
 *
 * @param {string} queueNamePrefix - prefix of the queue name
 * @returns {Object} - {deadLetterQueueUrl: <url>, queueUrl: <url>} queues created
 */
async function createSqsQueues(queueNamePrefix) {
  // dead letter queue
  const deadLetterQueueName = `${queueNamePrefix}DeadLetterQueue`;
  const deadLetterQueueParms = {
    QueueName: deadLetterQueueName,
    Attributes: {
      VisibilityTimeout: '300'
    }
  };
  const { QueueUrl: deadLetterQueueUrl } = await sqs()
    .createQueue(deadLetterQueueParms).promise();
  const qAttrParams = {
    QueueUrl: deadLetterQueueUrl,
    AttributeNames: ['QueueArn']
  };
  const { Attributes: { QueueArn: deadLetterQueueArn } } = await sqs()
    .getQueueAttributes(qAttrParams).promise();

  // source queue
  const queueName = `${queueNamePrefix}Queue`;
  const queueParms = {
    QueueName: queueName,
    Attributes: {
      RedrivePolicy: JSON.stringify({
        deadLetterTargetArn: deadLetterQueueArn,
        maxReceiveCount: 3
      }),
      VisibilityTimeout: '300'
    }
  };

  const { QueueUrl: queueUrl } = await sqs().createQueue(queueParms).promise();
  return { deadLetterQueueUrl, queueUrl };
}

/**
 * get message counts of the given SQS queue
 *
 * @param {string} queueUrl - SQS queue URL
 * @returns {Object} - message counts
 * {numberOfMessagesAvailable: <number>, numberOfMessagesNotVisible: <number>}
 */
async function getSqsQueueMessageCounts(queueUrl) {
  const qAttrParams = {
    QueueUrl: queueUrl,
    AttributeNames: ['All']
  };
  const attributes = await sqs().getQueueAttributes(qAttrParams).promise();
  const {
    ApproximateNumberOfMessages: numberOfMessagesAvailable,
    ApproximateNumberOfMessagesNotVisible: numberOfMessagesNotVisible
  } = attributes.Attributes;

  return {
    numberOfMessagesAvailable: parseInt(numberOfMessagesAvailable, 10),
    numberOfMessagesNotVisible: parseInt(numberOfMessagesNotVisible, 10)
  };
}

module.exports = {
  createFakeJwtAuthToken,
  createSqsQueues,
  fakeAccessTokenFactory,
  fakeGranuleFactory,
  fakeGranuleFactoryV2,
  fakePdrFactory,
  fakePdrFactoryV2,
  fakeCollectionFactory,
  fakeExecutionFactory,
  fakeExecutionFactoryV2,
  fakeRuleFactory,
  fakeRuleFactoryV2,
  fakeFileFactory,
  fakeProviderFactory,
  getSqsQueueMessageCounts,
  getWorkflowList,
  isLocalApi,
  testEndpoint,
  setAuthorizedOAuthUsers
};
