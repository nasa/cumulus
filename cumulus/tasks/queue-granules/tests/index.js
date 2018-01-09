/* eslint-disable no-param-reassign */
'use strict';

import test from 'ava';
import MockAWS from '@mapbox/mock-aws-sdk-js';

import { s3, sqs, putS3Object, deleteS3Bucket } from '@cumulus/common/aws';
import testUtils from '@cumulus/common/test-utils';

import { handler } from '../index';
import inputJSON from './fixtures/input.json';
import workflowTemplate from './fixtures/workflow-template.json';

test.beforeEach(async (t) => {
  t.context.bucket = testUtils.randomString();
  await sqs().createQueue({ QueueName: 'testQueue' }).promise();
  return s3().createBucket({ Bucket: t.context.bucket }).promise();
});

test.afterEach.always(async (t) => {
  await deleteS3Bucket(t.context.bucket);
  await sqs().deleteQueue({ QueueUrl: `http://${process.env.LOCALSTACK_HOST}:4576/queue/testQueue` }).promise();
});

test('queue granules', async (t) => {
  const bucket = t.context.bucket;
  const IngestGranuleTemplate = `s3://${bucket}/dev/workflows/IngestGranule.json`;

  await putS3Object({
    bucket,
    key: 'dev/workflows/IngestGranule.json',
    body: JSON.stringify(workflowTemplate)
  });

  MockAWS.stub('StepFunctions', 'describeExecution').returns({
    promise: () => Promise.resolve({})
  });

  const input = Object.assign({}, inputJSON);
  input.config.templates.IngestGranule = IngestGranuleTemplate;
  input.config.buckets.internal = t.context.bucket;
  input.config.queues.startSF = `http://${process.env.LOCALSTACK_HOST}:4576/queue/testQueue`;

  return handler(input, {}, (e, output) => {
    t.ifError(e);
    t.is(typeof output, 'object');
    t.is(output.granules_queued, 3);
    MockAWS.StepFunctions.restore();
  });
});
