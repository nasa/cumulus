'use strict';

const test = require('ava');
const { sqs } = require('@cumulus/aws-client/services');
const cloneDeep = require('lodash.clonedeep');
const { randomString } = require('@cumulus/common/test-utils');
const { reportSQSMessage } = require('..');

let bucket;

test.before(async () => {
  bucket = randomString();
  const queueName = randomString();
  const { QueueUrl } = await sqs().createQueue({ QueueName: queueName }).promise();
  process.env.reporting_queue_url = QueueUrl;
});

test.after.always(async () => {
  delete process.env.reporting_queue_arn;
});

test('task returns payload as output', async (t) => {
  const event = {
    input: {
      meta: { topic_arn: 'test_topic_arn' },
      anykey: 'anyvalue',
      payload: { someKey: 'someValue' }
    }
  };

  const output = await reportSQSMessage(cloneDeep(event));
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

  const output = await reportSQSMessage(cloneDeep(event));
  t.deepEqual(output, {});
});
