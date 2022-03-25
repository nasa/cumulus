'use strict';

const test = require('ava');
const sinon = require('sinon');
const proxyquire = require('proxyquire');

const awsServices = require('@cumulus/aws-client/services');
const { recursivelyDeleteS3Bucket } = require('@cumulus/aws-client/S3');
const { randomId, randomString } = require('@cumulus/common/test-utils');

const { fakeRuleFactoryV2 } = require('../../lib/testUtils');

const listRulesStub = sinon.stub();

const rulesHelpers = proxyquire('../../lib/rulesHelpers', {
  '@cumulus/api-client/rules': {
    listRules: listRulesStub,
  },
  '../lambdas/sf-scheduler': {
    handleScheduleEvent: (payload) => payload,
  },
});

let workflow;

test.before(async () => {
  workflow = randomString();
  process.env.system_bucket = randomString();
  process.env.stackName = randomString();
  await awsServices.s3().createBucket({ Bucket: process.env.system_bucket });
  const workflowfile = `${process.env.stackName}/workflows/${workflow}.json`;
  const templateFile = `${process.env.stackName}/workflow_template.json`;
  await Promise.all([
    awsServices.s3().putObject({
      Bucket: process.env.system_bucket,
      Key: workflowfile,
      Body: '{}',
    }),
    awsServices.s3().putObject({
      Bucket: process.env.system_bucket,
      Key: templateFile,
      Body: '{}',
    }),
  ]);
});

test.afterEach(() => {
  listRulesStub.reset();
});

test.after.always(async () => {
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
  delete process.env.system_bucket;
  delete process.env.stackName;
});

test.serial('fetchRules invokes API to fetch rules', async (t) => {
  const apiResults = [];
  listRulesStub.callsFake(({ prefix }) => {
    t.is(prefix, process.env.stackName);
    return { body: JSON.stringify({ results: apiResults }) };
  });
  const rules = await rulesHelpers.fetchRules({});

  t.deepEqual(rules, apiResults);
  t.true(listRulesStub.calledOnce);
});

test.serial('fetchRules pages through results until reaching an empty list', async (t) => {
  const rule1 = { name: 'rule-1' };
  const rule2 = { name: 'rule-2' };
  const firstCallArgs = {
    prefix: process.env.stackName,
    query: { page: 1 },
  };
  const secondCallArgs = {
    prefix: process.env.stackName,
    query: { page: 2 },
  };
  const thirdCallArgs = {
    prefix: process.env.stackName,
    query: { page: 3 },
  };
  listRulesStub.onFirstCall().callsFake((params) => {
    t.deepEqual(params, firstCallArgs);
    return { body: JSON.stringify({ results: [rule1] }) };
  });
  listRulesStub.onSecondCall().callsFake((params) => {
    t.deepEqual(params, secondCallArgs);
    return { body: JSON.stringify({ results: [rule2] }) };
  });
  listRulesStub.onThirdCall().callsFake((params) => {
    t.deepEqual(params, thirdCallArgs);
    return { body: JSON.stringify({ results: [] }) };
  });

  const expectedOutput = [rule1, rule2];
  const actualOutput = await rulesHelpers.fetchRules({});

  t.true(listRulesStub.calledThrice);
  t.true(listRulesStub.withArgs(firstCallArgs).calledOnce);
  t.true(listRulesStub.withArgs(secondCallArgs).calledOnce);
  t.true(listRulesStub.withArgs(thirdCallArgs).calledOnce);
  t.deepEqual(actualOutput, expectedOutput);
});

test.serial('fetchEnabledRules passes ENABLED state to listRules endpoint', async (t) => {
  listRulesStub.callsFake((params) => {
    t.is(params.query.state, 'ENABLED');
    return { body: JSON.stringify({ results: [] }) };
  });
  await rulesHelpers.fetchEnabledRules();
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

test('filterRulesByRuleParams filters on type', (t) => {
  const rule1 = fakeRuleFactoryV2({ rule: { type: 'sqs', sourceArn: randomString() } });
  const rule2 = fakeRuleFactoryV2({ rule: { type: 'kinesis', sourceArn: randomString() } });

  const ruleParamsToSelectRule1 = { type: 'sqs' };

  const results = rulesHelpers.filterRulesByRuleParams([rule1, rule2], ruleParamsToSelectRule1);
  t.deepEqual(results, [rule1]);
});

test('filterRulesByRuleParams filters on collection', (t) => {
  const rule1 = fakeRuleFactoryV2({ rule: { type: 'sqs', sourceArn: randomString() } });
  const rule2 = fakeRuleFactoryV2({ rule: { type: 'sqs', sourceArn: randomString() } });

  const ruleParamsToSelectRule1 = { ...rule1.collection };

  const results = rulesHelpers.filterRulesByRuleParams([rule1, rule2], ruleParamsToSelectRule1);
  t.deepEqual(results, [rule1]);
});

test('filterRulesByRuleParams filters on sourceArn', (t) => {
  const desiredSourceArn = randomString();
  const rule1 = fakeRuleFactoryV2({ rule: { type: 'sqs', value: desiredSourceArn } });
  const rule2 = fakeRuleFactoryV2({ rule: { type: 'sqs', value: randomString() } });

  const ruleParamsToSelectRule1 = { sourceArn: desiredSourceArn };

  const results = rulesHelpers.filterRulesByRuleParams([rule1, rule2], ruleParamsToSelectRule1);
  t.deepEqual(results, [rule1]);
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

test('queueMessageForRule includes queueUrl in rule, if provided', async (t) => {
  const rule = fakeRuleFactoryV2({ workflow });
  rule.queueUrl = 'queue-url';
  const payload = await rulesHelpers.queueMessageForRule(rule, {}, {});
  t.deepEqual(payload.queueUrl, rule.queueUrl);
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
