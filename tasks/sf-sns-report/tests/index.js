'use strict';

const test = require('ava');
const { s3 } = require('@cumulus/aws-client/services');
const { recursivelyDeleteS3Bucket } = require('@cumulus/aws-client/S3');
const cloneDeep = require('lodash.clonedeep');
const { randomString } = require('@cumulus/common/test-utils');
const { publishSnsMessage } = require('..');

let bucket;

test.before(async () => {
  bucket = randomString();
  await s3().createBucket({ Bucket: bucket }).promise();
});

test.after.always(async () => {
  await recursivelyDeleteS3Bucket(bucket);
});

test('task returns payload as output', async (t) => {
  const event = {
    input: {
      meta: { topic_arn: 'test_topic_arn' },
      anykey: 'anyvalue',
      payload: { someKey: 'someValue' }
    }
  };

  const output = await publishSnsMessage(cloneDeep(event));
  t.deepEqual(output, event.input.payload);
});

test('task returns empty object when no payload is present on input to the task', async (t) => {
  const input = {
    meta: {
      topic_arn: 'test_topic_arn',
      granuleId: randomString()
    },
    anykey: 'anyvalue'
  };
  const event = {};
  event.input = input;
  event.config = {};
  event.config.sfnEnd = true;
  event.config.stack = 'test_stack';
  event.config.bucket = bucket;
  event.config.stateMachine = 'arn:aws:states:us-east-1:000000000000:stateMachine:TestCumulusParsePdrStateMach-K5Qk90fc8w4U';
  event.config.executionName = '7c543392-1da9-47f0-9c34-f43f6519412a';

  const output = await publishSnsMessage(cloneDeep(event));
  t.deepEqual(output, {});
});
