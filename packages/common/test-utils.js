'use strict';

const crypto = require('crypto');
const url = require('url');
const aws = require('./aws');

/**
 * Generate a 40-character random string
 *
 * @returns {string} - a random string
 */
exports.randomString = () => crypto.randomBytes(20).toString('hex');

// From https://github.com/localstack/localstack/blob/master/README.md
// REVIEW(aimee): not really sure how this is working for cloudwatchlogs, since the service identifier for AWS.CloudWatchLogs is cloudwatchlogs. Perhaps there are no tests which include cloudwatchlogs.
const localStackPorts = {
  apigateway: 4567,
  cloudformation: 4581,
  cloudwatch: 4582,
  cloudwatchevents: 4582,
  dynamodb: 4569,
  dynamodbstreams: 4570,
  es: 4571,
  firehose: 4573,
  kinesis: 4568,
  lambda: 4574,
  redshift: 4577,
  route53: 4580,
  s3: 4572,
  ses: 4579,
  sns: 4575,
  sqs: 4576,
  ssm: 4583
};

/**
 * Test if a given AWS service is supported by LocalStack.
 *
 * @param {Function} Service - an AWS service object constructor function
 * @returns {boolean}
 */
function localstackSupportedService(Service) {
  const serviceIdentifier = Service.serviceIdentifier;
  return Object.keys(localStackPorts).indexOf(serviceIdentifier) !== -1;
}

/**
 * Create an AWS service object that talks to LocalStack.
 *
 * This function expects that the LOCALSTACK_HOST environment variable will be set.
 *
 * @param {Function} Service - an AWS service object constructor function
 * @param {Object} options - options to pass to the service object constructor function
 * @returns {Object} - an AWS service object
 */
function localStackAwsClient(Service, options) {
  if (!process.env.LOCALSTACK_HOST) {
    throw new Error('The LOCALSTACK_HOST environment variable is not set.');
  }

  const serviceIdentifier = Service.serviceIdentifier;

  const localStackOptions = Object.assign({}, options, {
    accessKeyId: 'my-access-key-id',
    secretAccessKey: 'my-secret-access-key',
    region: 'us-east-1',
    endpoint: `http://${process.env.LOCALSTACK_HOST}:${localStackPorts[serviceIdentifier]}`
  });

  if (serviceIdentifier === 's3') localStackOptions.s3ForcePathStyle = true;

  return new Service(localStackOptions);
}

/**
 * Create an AWS service object that does not actually talk to AWS.
 *
 * @todo Update this to return a mock AWS client if not supported by localstack
 *
 * @param {Function} Service - an AWS service object constructor function
 * @param {Object} options - options to pass to the service object constructor function
 * @returns {Object} - an AWS service object
 */
function testAwsClient(Service, options) {
  if (localstackSupportedService(Service)) {
    return localStackAwsClient(Service, options);
  }
  return new Service(Object.assign(options, { endpoint: 'http://you-forgot-to-stub-an-aws-call' }));
}
exports.testAwsClient = testAwsClient;

/**
 * Create an SQS queue for testing
 *
 * @returns {string} - an SQS queue URL
 */
async function createQueue() {
  const createQueueResponse = await aws.sqs().createQueue({
    QueueName: exports.randomString()
  }).promise();

  // Properly set the Queue URL.  This is needed because LocalStack always
  // returns the QueueUrl as "localhost", even if that is not where it should
  // actually be found.  CircleCI breaks without this.
  const returnedQueueUrl = url.parse(createQueueResponse.QueueUrl);
  returnedQueueUrl.host = undefined;
  returnedQueueUrl.hostname = process.env.LOCALSTACK_HOST;

  return url.format(returnedQueueUrl);
}
exports.createQueue = createQueue;
