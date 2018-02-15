/* eslint-disable no-param-reassign */
'use strict';

const test = require('ava');
const MockAWS = require('@mapbox/mock-aws-sdk-js');

const { s3, sqs, recursivelyDeleteS3Bucket } = require('@cumulus/common/aws');
const testUtils = require('@cumulus/common/test-utils');

const { handler } = require('../index');
const inputJSON = require('./fixtures/input.json');
const workflowTemplate = require('./fixtures/workflow-template.json');

const aws = require('@cumulus/common/aws');

test.beforeEach(async (t) => {
  t.context.bucket = testUtils.randomString();
  t.context.queue = testUtils.randomString();
  await sqs().createQueue({ QueueName: t.context.queue }).promise();
  await s3().createBucket({ Bucket: t.context.bucket }).promise();
});

test.afterEach.always(async (t) => {
  await recursivelyDeleteS3Bucket(t.context.bucket);
  await sqs().deleteQueue({ QueueUrl: `http://${process.env.LOCALSTACK_HOST}:4576/queue/${t.context.queue}` }).promise();
});

test('queue granules', async (t) => {
  const Bucket = t.context.bucket;
  const IngestGranuleTemplate = `s3://${Bucket}/dev/workflows/IngestGranule.json`;

  await aws.s3().putObject({
    Bucket,
    Key: 'dev/workflows/IngestGranule.json',
    Body: JSON.stringify(workflowTemplate)
  }).promise();

  MockAWS.stub('StepFunctions', 'describeExecution').returns({
    promise: () => Promise.resolve({})
  });

  const input = Object.assign({}, inputJSON);
  input.config.templateUri = IngestGranuleTemplate;
  input.config.bucket = t.context.bucket;
  input.config.queueUrl = `http://${process.env.LOCALSTACK_HOST}:4576/queue/${t.context.queue}`;

  return handler(input, {}, (e, output) => {
    t.ifError(e);
    t.is(typeof output, 'object');
    t.is(output.granules_queued, 3);
    MockAWS.StepFunctions.restore();
  });
});
