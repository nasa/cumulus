'use strict';

const test = require('ava');
const rewire = require('rewire');

const awsServices = require('@cumulus/aws-client/services');
const { recursivelyDeleteS3Bucket } = require('@cumulus/aws-client/S3');
const { randomId, randomString } = require('@cumulus/common/test-utils');

const { fakeRuleFactoryV2 } = require('../../lib/testUtils');
const rulesHelpers = rewire('../../lib/rulesHelpers');

rulesHelpers.__set__('handleScheduleEvent', (payload) => payload);

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
      Body: '{}',
    }).promise(),
    awsServices.s3().putObject({
      Bucket: process.env.system_bucket,
      Key: templateFile,
      Body: '{}',
    }).promise(),
  ]);
});

test.after(async () => {
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
  delete process.env.system_bucket;
  delete process.env.stackName;
});

test('filterRulesbyCollection returns rules with matching only collection name', (t) => {
  const collection = {
    name: randomId('name'),
  };
  const rule1 = fakeRuleFactoryV2({
    collection,
  });
  const rule2 = fakeRuleFactoryV2();
  t.deepEqual(
    rulesHelpers.filterRulesbyCollection([rule1, rule2], collection),
    [rule1]
  );
});

test('filterRulesbyCollection returns rules with matching collection name and version', (t) => {
  const collection = {
    name: randomId('name'),
    version: '1.0.0',
  };
  const rule1 = fakeRuleFactoryV2({
    collection,
  });
  const rule2 = fakeRuleFactoryV2({
    collection: {
      name: collection.name,
      version: '2.0.0',
    },
  });
  t.deepEqual(
    rulesHelpers.filterRulesbyCollection([rule1, rule2], collection),
    [rule1]
  );
});

test('filterRulesbyCollection handles rules with no collection information', (t) => {
  const collection = {
    name: randomId('name'),
    version: '1.0.0',
  };
  const rule1 = fakeRuleFactoryV2({
    collection,
  });
  const rule2 = fakeRuleFactoryV2();
  delete rule2.collection;
  t.deepEqual(
    rulesHelpers.filterRulesbyCollection([rule1, rule2], collection),
    [rule1]
  );
});

test('filterRulesbyCollection returns all rules if no collection information is provided', (t) => {
  const rule1 = fakeRuleFactoryV2();
  const rule2 = fakeRuleFactoryV2();

  t.deepEqual(
    rulesHelpers.filterRulesbyCollection([rule1, rule2], {}),
    [rule1, rule2]
  );
});

test('getMaxTimeoutForRules returns correct max timeout', (t) => {
  const rule1 = fakeRuleFactoryV2({
    meta: {
      visibilityTimeout: 5,
    },
  });
  const rule2 = fakeRuleFactoryV2({
    meta: {
      visibilityTimeout: 10,
    },
  });
  t.is(rulesHelpers.getMaxTimeoutForRules([rule1, rule2]), 10);
});

test('getMaxTimeoutForRules returns undefined for single rule with no timeout', (t) => {
  const rule = fakeRuleFactoryV2({
    meta: {},
  });
  t.is(rulesHelpers.getMaxTimeoutForRules([rule]), undefined);
});

test('getMaxTimeoutForRules returns undefined for multiple rules with no timeout', (t) => {
  const rule1 = fakeRuleFactoryV2({
    meta: {},
  });
  const rule2 = fakeRuleFactoryV2({
    meta: {},
  });
  t.is(rulesHelpers.getMaxTimeoutForRules([rule1, rule2]), undefined);
});

test('getMaxTimeoutForRules returns correct max for rules with and without timeouts', (t) => {
  const rule1 = fakeRuleFactoryV2({
    meta: {
      visibilityTimeout: 1,
    },
  });
  const rule2 = fakeRuleFactoryV2({
    meta: {},
  });
  t.is(rulesHelpers.getMaxTimeoutForRules([rule1, rule2]), 1);
});

test('queueMessageForRule respects eventObject with collection object', async (t) => {
  const rule = fakeRuleFactoryV2({ workflow });
  const event = {
    collection: {
      name: randomString(),
      version: randomString(),
      dataType: randomString(),
    },
  };
  const payload = await rulesHelpers.queueMessageForRule(rule, event);
  t.deepEqual(payload.collection, event.collection);
});

test('queueMessageForRule falls back to rule.collection for partial collection object', async (t) => {
  const rule = fakeRuleFactoryV2({ workflow });
  const event = {
    collection: {
      name: randomString(),
    },
  };
  const payload = await rulesHelpers.queueMessageForRule(rule, event);
  t.deepEqual(payload.collection, rule.collection);
});

test('queueMessageForRule respects eventObject with CNM-style collection', async (t) => {
  const rule = fakeRuleFactoryV2({ workflow });
  const event = {
    collection: 'test',
    product: {
      dataVersion: 'v1',
    },
  };
  const payload = await rulesHelpers.queueMessageForRule(rule, event);
  t.deepEqual(payload.collection, {
    name: 'test',
    version: 'v1',
  });
});

test('queueMessageForRule falls back to rule collection for partial CNM-style collection in the eventObject', async (t) => {
  const rule = fakeRuleFactoryV2({ workflow });
  const event = {
    collection: 'whatever',
  };
  const payload = await rulesHelpers.queueMessageForRule(rule, event);
  t.deepEqual(payload.collection, rule.collection);
});

test('queueMessageForRule falls back to rule collection if there is no collection in the eventObject', async (t) => {
  const rule = fakeRuleFactoryV2({ workflow });
  const event = {
    payload: 'whatever',
  };
  const payload = await rulesHelpers.queueMessageForRule(rule, event);
  t.deepEqual(payload.collection, rule.collection);
});

test('queueMessageForRule includes eventSource in payload, if provided', async (t) => {
  const rule = fakeRuleFactoryV2({ workflow });
  const eventSource = {
    foo: 'bar',
  };
  const payload = await rulesHelpers.queueMessageForRule(rule, {}, eventSource);
  t.deepEqual(payload.meta.eventSource, eventSource);
});

test('rulesHelpers.lookupCollectionInEvent returns collection for standard case', (t) => {
  const event = {
    collection: {
      name: 'test',
      version: 'v1',
    },
  };
  t.deepEqual(rulesHelpers.lookupCollectionInEvent(event), {
    name: 'test',
    version: 'v1',
  });
});

test('rulesHelpers.lookupCollectionInEvent returns collection for CNM case', (t) => {
  const event = {
    collection: 'test',
    product: {
      dataVersion: 'v1',
    },
  };
  t.deepEqual(rulesHelpers.lookupCollectionInEvent(event), {
    name: 'test',
    version: 'v1',
  });
});

test('rulesHelpers.lookupCollectionInEvent returns empty object for empty case', (t) => {
  t.deepEqual(rulesHelpers.lookupCollectionInEvent({}), {});
});
