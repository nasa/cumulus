'use strict';

const test = require('ava');
const sinon = require('sinon');
const proxyquire = require('proxyquire');

const awsServices = require('@cumulus/aws-client/services');
const { recursivelyDeleteS3Bucket } = require('@cumulus/aws-client/S3');
const { randomId, randomString } = require('@cumulus/common/test-utils');
const {
  destroyLocalTestDb,
  fakeRuleRecordFactory,
  generateLocalTestDb,
  localStackConnectionEnv,
  migrationDir,
  RulePgModel,
  TableNames,
} = require('@cumulus/db');

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
const testDbName = randomString(12);

process.env.messageConsumer = randomString();
process.env.KinesisInboundEventLogger = randomString();
const eventLambdas = [process.env.messageConsumer, process.env.KinesisInboundEventLogger];

const createEventSourceMapping = async (rule) => {
  // create event source mapping
  const eventSourceMapping = eventLambdas.map((lambda) => {
    const params = {
      EventSourceArn: rule.value,
      FunctionName: lambda,
      StartingPosition: 'TRIM_HORIZON',
      Enabled: true,
    };
    return awsServices.lambda().createEventSourceMapping(params).promise();
  });
  return await Promise.all(eventSourceMapping);
};

const getKinesisEventMappings = async () => {
  const mappingPromises = eventLambdas.map((lambda) => {
    const mappingParms = { FunctionName: lambda };
    return awsServices.lambda().listEventSourceMappings(mappingParms).promise();
  });
  return await Promise.all(mappingPromises);
};

test.before(async (t) => {
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

  process.env = {
    ...process.env,
    ...localStackConnectionEnv,
    PG_DATABASE: testDbName,
  };

  const { knex, knexAdmin } = await generateLocalTestDb(testDbName, migrationDir);
  t.context.testKnex = knex;
  t.context.testKnexAdmin = knexAdmin;
  t.context.rulePgModel = new RulePgModel();
});

test.afterEach.always(async (t) => {
  listRulesStub.reset();
  await t.context.testKnex(TableNames.rules).del();
});

test.after.always(async (t) => {
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
  delete process.env.system_bucket;
  delete process.env.stackName;
  await destroyLocalTestDb({
    knex: t.context.testKnex,
    knexAdmin: t.context.testKnexAdmin,
    testDbName,
  });
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

test.serial('deleteKinesisEventSource deletes a kinesis event source', async (t) => {
  const {
    rulePgModel,
    testKnex,
  } = t.context;

  const params = {
    arn: randomString(),
    type: 'kinesis',
    enabled: true,
    value: randomString(),
  };
  const kinesisRule = fakeRuleRecordFactory(params);
  const result = await createEventSourceMapping(kinesisRule);

  // Update Kinesis Rule ARNs
  kinesisRule.arn = result[0].UUID;
  kinesisRule.log_event_arn = result[1].UUID;
  await rulePgModel.create(testKnex, kinesisRule);

  const kinesisEventMappings = await getKinesisEventMappings(kinesisRule);

  const consumerEventMappings = kinesisEventMappings[0].EventSourceMappings;
  const logEventMappings = kinesisEventMappings[1].EventSourceMappings;
  t.is(consumerEventMappings.length, 1);
  t.is(logEventMappings.length, 1);

  await rulesHelpers.deleteKinesisEventSource(kinesisRule, 'arn', { arn: kinesisRule.arn });
  const deletedEventMappings = await getKinesisEventMappings(kinesisRule);
  const deletedConsumerEventMappings = deletedEventMappings[0].EventSourceMappings;
  const deletedLogEventMappings = deletedEventMappings[1].EventSourceMappings;

  t.is(deletedConsumerEventMappings.length, 0);
  t.is(deletedLogEventMappings.length, 1);
  t.teardown(async () => {
    await rulesHelpers.deleteKinesisEventSource(kinesisRule, 'log_event_arn', { log_event_arn: kinesisRule.log_event_arn });
  });
});

test.serial('deleteKinesisEventSources deletes all kinesis event sources', async (t) => {
  const {
    rulePgModel,
    testKnex,
  } = t.context;

  const params = {
    arn: randomString(),
    type: 'kinesis',
    enabled: true,
    value: randomString(),
  };
  const kinesisRule = fakeRuleRecordFactory(params);
  const result = await createEventSourceMapping(kinesisRule);

  // Update Kinesis Rule ARNs
  kinesisRule.arn = result[0].UUID;
  kinesisRule.log_event_arn = result[1].UUID;
  await rulePgModel.create(testKnex, kinesisRule);

  const kinesisEventMappings = await getKinesisEventMappings(kinesisRule);

  const consumerEventMappings = kinesisEventMappings[0].EventSourceMappings;
  const logEventMappings = kinesisEventMappings[1].EventSourceMappings;
  t.is(consumerEventMappings.length, 1);
  t.is(logEventMappings.length, 1);

  await rulesHelpers.deleteKinesisEventSources(kinesisRule);
  const deletedEventMappings = await getKinesisEventMappings(kinesisRule);
  const deletedConsumerEventMappings = deletedEventMappings[0].EventSourceMappings;
  const deletedLogEventMappings = deletedEventMappings[1].EventSourceMappings;

  t.is(deletedConsumerEventMappings.length, 0);
  t.is(deletedLogEventMappings.length, 0);
});

test.serial('isEventSourceMappingShared returns true if a rule shares an event source with another rule', async (t) => {
  const {
    rulePgModel,
    testKnex,
  } = t.context;
  const eventType = { arn: 'fakeArn' };
  const firstRule = fakeRuleRecordFactory({ ...eventType, type: 'kinesis' });
  const secondRule = fakeRuleRecordFactory({ ...eventType, type: 'kinesis' });
  await rulePgModel.create(testKnex, firstRule);
  await rulePgModel.create(testKnex, secondRule);
  t.true(await rulesHelpers.isEventSourceMappingShared(firstRule, eventType));
});

test.serial('isEventSourceMappingShared returns false if a rule does not share an event source with another rule', async (t) => {
  const {
    rulePgModel,
    testKnex,
  } = t.context;
  const eventType = { arn: 'fakeArn' };
  const newRule = fakeRuleRecordFactory({ ...eventType, type: 'kinesis' });
  await rulePgModel.create(testKnex, newRule);
  t.false(await rulesHelpers.isEventSourceMappingShared(newRule, eventType));
});

test.serial('deleteSnsTrigger deletes a rule SNS trigger', async (t) => {
  const sandbox = sinon.createSandbox();
  sandbox.stub(awsServices, 'lambda')
    .returns({
      addPermission: () => ({
        promise: () => Promise.resolve(),
      }),
      removePermission: () => ({
        promise: () => Promise.resolve(),
      }),
    });
  const snsStub = sinon.stub(awsServices, 'sns')
    .returns({
      listSubscriptionsByTopic: () => ({
        promise: () => Promise.resolve({
          Subscriptions: [{
            Endpoint: process.env.messageConsumer,
            SubscriptionArn: randomString(),
          }],
        }),
      }),
      unsubscribe: () => ({
        promise: () => Promise.resolve(),
      }),
    });
  const unsubscribeSpy = sinon.spy(awsServices.sns(), 'unsubscribe');
  const snsTopicArn = randomString();
  const params = {
    arn: randomString(),
    type: 'sns',
    enabled: true,
    value: snsTopicArn,
  };
  const snsRule = fakeRuleRecordFactory(params);

  await rulesHelpers.deleteSnsTrigger(snsRule);
  t.true(unsubscribeSpy.called);
  t.true(unsubscribeSpy.calledWith({
    SubscriptionArn: snsRule.arn,
  }));

  t.teardown(() => {
    sandbox.restore();
    snsStub.restore();
    unsubscribeSpy.restore();
  });
});

test.serial('deleteRuleResources correctly deletes resources for scheduled rule', async (t) => {
  const params = {
    type: 'scheduled',
    enabled: true,
    value: 'rate(1 minute)',
  };
  const sandbox = sinon.createSandbox();
  sandbox.stub(awsServices, 'cloudwatchevents')
    .returns({
      removeTargets: () => ({
        promise: () => Promise.resolve(),
      }),
      deleteRule: () => ({
        promise: () => Promise.resolve(),
      }),
    });
  const scheduledRule = fakeRuleRecordFactory(params);
  const name = `${process.env.stackName}-custom-${scheduledRule.name}`;
  const deleteRuleSpy = sinon.spy(awsServices.cloudwatchevents(), 'deleteRule');
  const removeTargetsSpy = sinon.spy(awsServices.cloudwatchevents(), 'removeTargets');

  await rulesHelpers.deleteRuleResources(scheduledRule);

  t.true(deleteRuleSpy.called);
  t.true(deleteRuleSpy.calledWith({
    Name: name,
  }));

  t.true(removeTargetsSpy.called);
  t.true(removeTargetsSpy.calledWith({
    Ids: ['lambdaTarget'],
    Rule: name,
  }));
  t.teardown(() => {
    deleteRuleSpy.restore();
    removeTargetsSpy.restore();
    sandbox.restore();
  });
});

test.serial('deleteRuleResources correctly deletes resources for kinesis rule', async (t) => {
  const {
    rulePgModel,
    testKnex,
  } = t.context;

  const params = {
    arn: randomString(),
    type: 'kinesis',
    enabled: true,
    value: randomString(),
  };
  const kinesisRule = fakeRuleRecordFactory(params);
  const result = await createEventSourceMapping(kinesisRule);

  // Update Kinesis Rule ARNs
  kinesisRule.arn = result[0].UUID;
  kinesisRule.log_event_arn = result[1].UUID;
  await rulePgModel.create(testKnex, kinesisRule);

  const kinesisEventMappings = await getKinesisEventMappings(kinesisRule);

  const consumerEventMappings = kinesisEventMappings[0].EventSourceMappings;
  const logEventMappings = kinesisEventMappings[1].EventSourceMappings;
  t.is(consumerEventMappings.length, 1);
  t.is(logEventMappings.length, 1);

  await rulesHelpers.deleteRuleResources(kinesisRule);
  const deletedEventMappings = await getKinesisEventMappings(kinesisRule);
  const deletedConsumerEventMappings = deletedEventMappings[0].EventSourceMappings;
  const deletedLogEventMappings = deletedEventMappings[1].EventSourceMappings;

  t.is(deletedConsumerEventMappings.length, 0);
  t.is(deletedLogEventMappings.length, 0);
});

test.serial('deleteRuleResources correctly deletes resources for sns rule', async (t) => {
  const lambdaStub = sinon.stub(awsServices, 'lambda')
    .returns({
      addPermission: () => ({
        promise: () => Promise.resolve(),
      }),
      removePermission: () => ({
        promise: () => Promise.resolve(),
      }),
    });
  const snsStub = sinon.stub(awsServices, 'sns')
    .returns({
      listSubscriptionsByTopic: () => ({
        promise: () => Promise.resolve({
          Subscriptions: [{
            Endpoint: process.env.messageConsumer,
            SubscriptionArn: randomString(),
          }],
        }),
      }),
      unsubscribe: () => ({
        promise: () => Promise.resolve(),
      }),
    });
  const unsubscribeSpy = sinon.spy(awsServices.sns(), 'unsubscribe');
  const snsTopicArn = randomString();
  const params = {
    arn: randomString(),
    type: 'sns',
    enabled: true,
    value: snsTopicArn,
  };
  const snsRule = fakeRuleRecordFactory(params);

  await rulesHelpers.deleteRuleResources(snsRule);
  t.true(unsubscribeSpy.called);
  t.true(unsubscribeSpy.calledWith({
    SubscriptionArn: snsRule.arn,
  }));

  t.teardown(() => {
    lambdaStub.restore();
    snsStub.restore();
    unsubscribeSpy.restore();
  });
});
