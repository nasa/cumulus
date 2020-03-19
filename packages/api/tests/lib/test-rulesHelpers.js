'use strict';

const test = require('ava');
const rewire = require('rewire');

const awsServices = require('@cumulus/aws-client/services');
const { recursivelyDeleteS3Bucket } = require('@cumulus/aws-client/S3');
const { randomString } = require('@cumulus/common/test-utils');

const { fakeRuleFactoryV2 } = require('../../lib/testUtils');
const rulesHelpers = rewire('../../lib/rulesHelpers');
rulesHelpers.__set__('schedule', (payload) => payload);

let workflow;

test.before(async () => {
  workflow = randomString();
  process.env.system_bucket = randomString();
  process.env.stackName = randomString();
  await awsServices.s3().createBucket({ Bucket: process.env.system_bucket }).promise();
  const workflowfile = `${process.env.stackName}/workflows/${workflow}.json`;
  const templateFile = `${process.env.stackName}/workflow_template.json`;
  await Promise.all([
    awsServices.s3().putObject({
      Bucket: process.env.system_bucket,
      Key: workflowfile,
      Body: '{}'
    }).promise(),
    awsServices.s3().putObject({
      Bucket: process.env.system_bucket,
      Key: templateFile,
      Body: '{}'
    }).promise()
  ]);
});

test.after(async () => {
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
  delete process.env.system_bucket;
  delete process.env.stackName;
});

test('queueMessageForRule respects eventObject with collection at top level', async (t) => {
  const rule = fakeRuleFactoryV2({ workflow });
  const event = {
    name: randomString(),
    version: randomString(),
    dataType: randomString()
  };
  const payload = await rulesHelpers.queueMessageForRule(rule, event);
  t.deepEqual(payload.collection, event);
});

test('queueMessageForRule respects eventObject with nested collection', async (t) => {
  const rule = fakeRuleFactoryV2({ workflow });
  const event = {
    collection: {
      name: randomString(),
      version: randomString(),
      dataType: randomString()
    }
  };
  const payload = await rulesHelpers.queueMessageForRule(rule, event);
  t.deepEqual(payload.collection, event.collection);
});

test('queueMessageForRule falls back to rule collection', async (t) => {
  const rule = fakeRuleFactoryV2({ workflow });
  const event = {
    payload: 'whatever'
  };
  const payload = await rulesHelpers.queueMessageForRule(rule, event);
  t.deepEqual(payload.collection, rule.collection);
});
