const AWS = require('aws-sdk');
const { noop } = require('@cumulus/common/util');

const { inTestMode, testAwsClient } = require('./test-utils');

exports.region = process.env.AWS_DEFAULT_REGION || 'us-east-1';
AWS.config.update({ region: exports.region });

// Workaround upload hangs. See: https://github.com/andrewrk/node-s3-client/issues/74'
AWS.util.update(AWS.S3.prototype, { addExpect100Continue: noop });
AWS.config.setPromisesDependency(Promise);

const memoize = (fn) => {
  let memo = null;
  return (options) => {
    if (!memo) memo = fn(options);
    return memo;
  };
};

/**
 * Return a function which, when called, will return an AWS service object
 *
 * Note: The returned service objects are cached, so there will only be one
 *       instance of each service object per process.
 *
 * @param {Function} Service - an AWS service object constructor function
 * @param {string} version - the API version to use
 * @returns {Function} - a function which, when called, will return an AWS service object
 */
const awsClient = (Service, version = null) => {
  const options = {};
  if (version) options.apiVersion = version;

  if (inTestMode()) {
    if (AWS.DynamoDB.DocumentClient.serviceIdentifier === undefined) {
      AWS.DynamoDB.DocumentClient.serviceIdentifier = 'dynamodb';
    }
    return memoize((o) => testAwsClient(Service, Object.assign(options, o)));
  }
  return memoize((o) => new Service(Object.assign(options, o)));
};

exports.apigateway = awsClient(AWS.APIGateway, '2015-07-09');
exports.ecs = awsClient(AWS.ECS, '2014-11-13');
exports.s3 = awsClient(AWS.S3, '2006-03-01');
exports.kinesis = awsClient(AWS.Kinesis, '2013-12-02');
exports.lambda = awsClient(AWS.Lambda, '2015-03-31');
exports.sqs = awsClient(AWS.SQS, '2012-11-05');
exports.cloudwatchevents = awsClient(AWS.CloudWatchEvents, '2014-02-03');
exports.cloudwatchlogs = awsClient(AWS.CloudWatchLogs, '2014-03-28');
exports.cloudwatch = awsClient(AWS.CloudWatch, '2010-08-01');
exports.dynamodb = awsClient(AWS.DynamoDB, '2012-08-10');
exports.dynamodbstreams = awsClient(AWS.DynamoDBStreams, '2012-08-10');
exports.dynamodbDocClient = awsClient(AWS.DynamoDB.DocumentClient, '2012-08-10');
exports.sfn = awsClient(AWS.StepFunctions, '2016-11-23');
exports.cf = awsClient(AWS.CloudFormation, '2010-05-15');
exports.sns = awsClient(AWS.SNS, '2010-03-31');
exports.secretsManager = awsClient(AWS.SecretsManager, '2017-10-17');
