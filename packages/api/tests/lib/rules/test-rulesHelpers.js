'use strict';

const test = require('ava');
const sinon = require('sinon');
const proxyquire = require('proxyquire');
const fs = require('fs-extra');

const awsServices = require('@cumulus/aws-client/services');
const { recursivelyDeleteS3Bucket } = require('@cumulus/aws-client/S3');
const { sqsQueueExists } = require('@cumulus/aws-client/SQS');
const { randomId, randomString } = require('@cumulus/common/test-utils');
const {
  destroyLocalTestDb,
  generateLocalTestDb,
  localStackConnectionEnv,
  migrationDir,
  RulePgModel,
  translateApiRuleToPostgresRuleRaw,
} = require('@cumulus/db');

const { createSqsQueues, fakeRuleFactoryV2 } = require('../../../lib/testUtils');
const {
  checkForSnsSubscriptions,
  createRuleTrigger,
  deleteRuleResources,
  deleteOldEventSourceMappings,
} = require('../../../lib/rulesHelpers');
const { getSnsTriggerPermissionId } = require('../../../lib/snsRuleHelpers');

const listRulesStub = sinon.stub();

const rulesHelpers = proxyquire('../../../lib/rulesHelpers', {
  '@cumulus/api-client/rules': {
    listRules: listRulesStub,
  },
  '../lambdas/sf-scheduler': {
    handleScheduleEvent: (payload) => payload,
  },
});

const testDbName = randomString(12);

let workflow;
let eventLambdas;

const createEventSourceMapping = async (rule) => {
  // create event source mapping
  const eventSourceMapping = eventLambdas.map((lambda) => {
    const params = {
      EventSourceArn: rule.rule.value,
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
  process.env.KinesisInboundEventLogger = randomString();
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

  const lambda = await awsServices.lambda().createFunction({
    Code: {
      ZipFile: fs.readFileSync(require.resolve('@cumulus/test-data/fake-lambdas/hello.zip')),
    },
    FunctionName: randomId('messageConsumer'),
    Role: randomId('role'),
    Handler: 'index.handler',
    Runtime: 'nodejs14.x',
  }).promise();
  process.env.messageConsumer = lambda.FunctionName;
  process.env.messageConsumerArn = lambda.FunctionArn;

  eventLambdas = [process.env.messageConsumer, process.env.KinesisInboundEventLogger];

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

test.afterEach.always(() => {
  listRulesStub.reset();
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
  const kinesisArn = `arn:aws:kinesis:us-east-1:000000000000:${randomId('kinesis')}`;
  const {
    rulePgModel,
    testKnex,
  } = t.context;

  const params = {
    rule: {
      arn: kinesisArn,
      type: 'kinesis',
      value: kinesisArn,
    },
    state: 'ENABLED',
    provider: null,
    collection: null,
  };
  const kinesisRule = fakeRuleFactoryV2(params);
  console.log(`kinesisRule: ${JSON.stringify(kinesisRule)}`);
  const result = await createEventSourceMapping(kinesisRule);
  console.log('createdEventSourceMapping');

  // Update Kinesis Rule ARNs
  kinesisRule.rule.arn = result[0].UUID;
  kinesisRule.rule.logEventArn = result[1].UUID;
  const pgRule = await translateApiRuleToPostgresRuleRaw(kinesisRule, testKnex);
  await rulePgModel.create(testKnex, pgRule);

  const kinesisEventMappings = await getKinesisEventMappings();

  const consumerEventMappings = kinesisEventMappings[0].EventSourceMappings;
  const logEventMappings = kinesisEventMappings[1].EventSourceMappings;
  t.is(consumerEventMappings.length, 1);
  t.is(logEventMappings.length, 1);

  await rulesHelpers.deleteKinesisEventSource(testKnex, kinesisRule, 'arn', { arn: kinesisRule.rule.arn });
  const deletedEventMappings = await getKinesisEventMappings();
  const deletedConsumerEventMappings = deletedEventMappings[0].EventSourceMappings;
  const deletedLogEventMappings = deletedEventMappings[1].EventSourceMappings;

  t.is(deletedConsumerEventMappings.length, 0);
  t.is(deletedLogEventMappings.length, 1);
  t.teardown(async () => {
    await rulesHelpers.deleteKinesisEventSource(testKnex, kinesisRule, 'log_event_arn', { log_event_arn: kinesisRule.rule.logEventArn });
  });
});

test.serial('deleteKinesisEventSources deletes all kinesis event sources', async (t) => {
  const kinesisArn = `arn:aws:kinesis:us-east-1:000000000000:${randomId('kinesis')}`;
  const {
    rulePgModel,
    testKnex,
  } = t.context;

  const params = {
    rule: {
      arn: kinesisArn,
      type: 'kinesis',
      value: kinesisArn,
    },
    state: 'ENABLED',
    provider: null,
    collection: null,
  };
  const kinesisRule = fakeRuleFactoryV2(params);
  const result = await createEventSourceMapping(kinesisRule);

  // Update Kinesis Rule ARNs
  kinesisRule.rule.arn = result[0].UUID;
  kinesisRule.rule.logEventArn = result[1].UUID;
  const pgRule = await translateApiRuleToPostgresRuleRaw(kinesisRule, testKnex);
  await rulePgModel.create(testKnex, pgRule);

  const kinesisEventMappings = await getKinesisEventMappings();

  const consumerEventMappings = kinesisEventMappings[0].EventSourceMappings;
  const logEventMappings = kinesisEventMappings[1].EventSourceMappings;
  t.is(consumerEventMappings.length, 1);
  t.is(logEventMappings.length, 1);

  await rulesHelpers.deleteKinesisEventSources(testKnex, kinesisRule);
  const deletedEventMappings = await getKinesisEventMappings();
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
  const firstRule = fakeRuleFactoryV2({
    rule: {
      ...eventType,
      type: 'kinesis',
    },
    provider: null,
    collection: null,
  });
  const secondRule = fakeRuleFactoryV2({
    rule: {
      ...eventType,
      type: 'kinesis',
    },
    provider: null,
    collection: null,
  });
  const firstPgRule = await translateApiRuleToPostgresRuleRaw(firstRule, testKnex);
  const secondPgRule = await translateApiRuleToPostgresRuleRaw(secondRule, testKnex);
  await rulePgModel.create(testKnex, firstPgRule);
  await rulePgModel.create(testKnex, secondPgRule);
  t.true(await rulesHelpers.isEventSourceMappingShared(testKnex, firstRule, eventType));
});

test.serial('isEventSourceMappingShared returns false if a rule does not share an event source with another rule', async (t) => {
  const {
    rulePgModel,
    testKnex,
  } = t.context;
  const eventType = { arn: randomString() };
  const newRule = fakeRuleFactoryV2({
    rule: {
      ...eventType,
      type: 'kinesis',
    },
    provider: null,
    collection: null,
  });
  const pgRule = await translateApiRuleToPostgresRuleRaw(newRule, testKnex);
  await rulePgModel.create(testKnex, pgRule);
  t.false(await rulesHelpers.isEventSourceMappingShared(testKnex, newRule, eventType));
});

test.serial('deleteSnsTrigger deletes a rule SNS trigger', async (t) => {
  const { testKnex } = t.context;
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
    rule: {
      arn: randomString(),
      type: 'sns',
      value: snsTopicArn,
    },
    state: 'ENABLED',
  };
  const snsRule = fakeRuleFactoryV2(params);

  await rulesHelpers.deleteSnsTrigger(testKnex, snsRule);
  t.true(unsubscribeSpy.called);
  t.true(unsubscribeSpy.calledWith({
    SubscriptionArn: snsRule.rule.arn,
  }));

  t.teardown(() => {
    sandbox.restore();
    snsStub.restore();
    unsubscribeSpy.restore();
  });
});

test.serial('deleteRuleResources correctly deletes resources for scheduled rule', async (t) => {
  const { testKnex } = t.context;
  const params = {
    rule: {
      type: 'scheduled',
      value: 'rate(1 minute)',
    },
    state: 'ENABLED',
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
  const scheduledRule = fakeRuleFactoryV2(params);
  const name = `${process.env.stackName}-custom-${scheduledRule.name}`;
  const deleteRuleSpy = sinon.spy(awsServices.cloudwatchevents(), 'deleteRule');
  const removeTargetsSpy = sinon.spy(awsServices.cloudwatchevents(), 'removeTargets');

  await deleteRuleResources(testKnex, scheduledRule);

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
  const kinesisArn = `arn:aws:kinesis:us-east-1:000000000000:${randomId('kinesis')}`;
  const {
    rulePgModel,
    testKnex,
  } = t.context;

  const params = {
    rule: {
      arn: kinesisArn,
      type: 'kinesis',
      value: kinesisArn,
    },
    state: 'ENABLED',
    collection: null,
    provider: null,
  };
  const kinesisRule = fakeRuleFactoryV2(params);
  const result = await createEventSourceMapping(kinesisRule);

  // Update Kinesis Rule ARNs
  kinesisRule.rule.arn = result[0].UUID;
  kinesisRule.rule.logEventArn = result[1].UUID;
  const pgRule = await translateApiRuleToPostgresRuleRaw(kinesisRule, testKnex);
  await rulePgModel.create(testKnex, pgRule);

  const kinesisEventMappings = await getKinesisEventMappings();

  const consumerEventMappings = kinesisEventMappings[0].EventSourceMappings;
  const logEventMappings = kinesisEventMappings[1].EventSourceMappings;
  t.is(consumerEventMappings.length, 1);
  t.is(logEventMappings.length, 1);

  await deleteRuleResources(testKnex, kinesisRule);
  const deletedEventMappings = await getKinesisEventMappings();
  const deletedConsumerEventMappings = deletedEventMappings[0].EventSourceMappings;
  const deletedLogEventMappings = deletedEventMappings[1].EventSourceMappings;

  t.is(deletedConsumerEventMappings.length, 0);
  t.is(deletedLogEventMappings.length, 0);
});

test.serial('deleteRuleResources correctly deletes resources for sns rule', async (t) => {
  const { testKnex } = t.context;
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
    rule: {
      arn: randomString(),
      type: 'sns',
      value: snsTopicArn,
    },
    state: 'ENABLED',
  };
  const snsRule = fakeRuleFactoryV2(params);

  await deleteRuleResources(testKnex, snsRule);
  t.true(unsubscribeSpy.called);
  t.true(unsubscribeSpy.calledWith({
    SubscriptionArn: snsRule.rule.arn,
  }));

  t.teardown(() => {
    lambdaStub.restore();
    snsStub.restore();
    unsubscribeSpy.restore();
  });
});

test.serial('deleteRuleResources does nothing when the rule is an SQS rule', async (t) => {
  const { testKnex } = t.context;
  const queues = await createSqsQueues(randomString());
  const params = {
    rule: {
      type: 'sqs',
      value: queues.queueUrl,
    },
    state: 'ENABLED',
  };
  const sqsRule = fakeRuleFactoryV2(params);
  await deleteRuleResources(testKnex, sqsRule);
  t.true(await sqsQueueExists(queues.queueUrl));
  const queuesToDelete = [
    queues.queueUrl,
    queues.deadLetterQueueUrl,
  ];
  await Promise.all(
    queuesToDelete.map(
      (queueUrl) => awsServices.sqs().deleteQueue({ QueueUrl: queueUrl }).promise()
    )
  );
});

test.serial('deleteRuleResources does not delete event source mappings if they exist for other rules', async (t) => {
  const kinesisArn = `arn:aws:kinesis:us-east-1:000000000000:${randomId('kinesis')}`;
  const {
    rulePgModel,
    testKnex,
  } = t.context;

  const params = {
    rule: {
      arn: kinesisArn,
      type: 'kinesis',
      value: kinesisArn,
    },
    state: 'ENABLED',
    provider: null,
    collection: null,
  };
  const kinesisRule = fakeRuleFactoryV2(params);
  const secondKinesisRule = fakeRuleFactoryV2(params);
  const result = await createEventSourceMapping(kinesisRule);

  // Update Kinesis Rule ARNs
  kinesisRule.rule.arn = result[0].UUID;
  kinesisRule.rule.logEventArn = result[1].UUID;

  secondKinesisRule.rule.arn = result[0].UUID;
  secondKinesisRule.rule.logEventArn = result[1].UUID;

  const firstPgRule = await translateApiRuleToPostgresRuleRaw(kinesisRule, testKnex);
  const secondPgRule = await translateApiRuleToPostgresRuleRaw(secondKinesisRule, testKnex);
  const [newFirstPgRule] = await rulePgModel.create(testKnex, firstPgRule);
  const [newSecondPgRule] = await rulePgModel.create(testKnex, secondPgRule);

  const kinesisEventMappings = await getKinesisEventMappings();

  const consumerEventMappings = kinesisEventMappings[0].EventSourceMappings;
  const logEventMappings = kinesisEventMappings[1].EventSourceMappings;

  // delete rule resources for the second rule, it should not delete the event source mapping
  await deleteRuleResources(testKnex, secondKinesisRule);
  const kinesisEventMappings2 = await getKinesisEventMappings();
  const consumerEventMappings2 = kinesisEventMappings2[0].EventSourceMappings;
  const logEventMappings2 = kinesisEventMappings2[1].EventSourceMappings;
  // Check for same event source mapping
  t.deepEqual(consumerEventMappings, consumerEventMappings2);
  t.deepEqual(logEventMappings, logEventMappings2);

  // create third rule, it should use the existing event source mapping
  const thirdKinesisRule = fakeRuleFactoryV2(params);
  thirdKinesisRule.rule.arn = kinesisRule.rule.arn;
  thirdKinesisRule.rule.logEventArn = kinesisRule.rule.logEventArn;

  const thirdPgRule = await translateApiRuleToPostgresRuleRaw(thirdKinesisRule, testKnex);
  const [newThirdPgRule] = await rulePgModel.create(testKnex, thirdPgRule);
  const kinesisEventMappings3 = await getKinesisEventMappings();

  const consumerEventMappings3 = kinesisEventMappings3[0].EventSourceMappings;
  const logEventMappings3 = kinesisEventMappings3[1].EventSourceMappings;
  // Check for same event source mapping
  t.deepEqual(consumerEventMappings, consumerEventMappings3);
  t.deepEqual(logEventMappings, logEventMappings3);

  t.teardown(async () => {
    await deleteRuleResources(testKnex, kinesisRule);
    await rulePgModel.delete(testKnex, newFirstPgRule);
    await deleteRuleResources(testKnex, secondKinesisRule);
    await rulePgModel.delete(testKnex, newSecondPgRule);
    await deleteRuleResources(testKnex, thirdKinesisRule);
    await rulePgModel.delete(testKnex, newThirdPgRule);
  });
});

test.serial('deleteOldEventSourceMappings() removes SNS source mappings and permissions', async (t) => {
  const {
    rulePgModel,
    testKnex,
  } = t.context;

  const topic1 = await awsServices.sns().createTopic({ Name: randomId('topic1_') }).promise();

  // create rule trigger and rule
  const snsRule = fakeRuleFactoryV2({
    workflow,
    rule: {
      type: 'sns',
      value: topic1.TopicArn,
    },
    provider: null,
    collection: null,
    state: 'ENABLED',
  });

  const ruleWithTrigger = await createRuleTrigger(snsRule);
  const pgRule = await translateApiRuleToPostgresRuleRaw(ruleWithTrigger, testKnex);
  const [newPgRule] = await rulePgModel.create(testKnex, pgRule);

  const { subExists } = await checkForSnsSubscriptions(ruleWithTrigger);
  t.true(subExists);

  const { Policy } = await awsServices.lambda().getPolicy({
    FunctionName: process.env.messageConsumer,
  }).promise();
  const { Statement } = JSON.parse(Policy);
  t.true(Statement.some((s) => s.Sid === getSnsTriggerPermissionId(ruleWithTrigger)));

  await deleteOldEventSourceMappings(testKnex, ruleWithTrigger);

  const { subExists: subExists2 } = await checkForSnsSubscriptions(ruleWithTrigger);
  t.false(subExists2);

  await t.throwsAsync(
    awsServices.lambda().getPolicy({
      FunctionName: process.env.messageConsumer,
    }).promise(),
    { code: 'ResourceNotFoundException' }
  );
  t.teardown(() => rulePgModel.delete(testKnex, newPgRule));
});

test.serial('deleteOldEventSourceMappings() removes kinesis source mappings', async (t) => {
  const {
    rulePgModel,
    testKnex,
  } = t.context;

  const kinesisArn = `arn:aws:kinesis:us-east-1:000000000000:${randomId('kinesis')}`;

  const params = {
    rule: {
      arn: kinesisArn,
      type: 'kinesis',
      value: kinesisArn,
    },
    state: 'ENABLED',
    provider: null,
    collection: null,
    workflow,
  };
  const kinesisRule = fakeRuleFactoryV2(params);

  // create rule trigger and rule
  kinesisRule.rule.value = `arn:aws:kinesis:us-east-1:000000000000:${randomId('kinesis1')}`;
  const ruleWithTrigger = await createRuleTrigger(kinesisRule);
  const pgRule = await translateApiRuleToPostgresRuleRaw(ruleWithTrigger, testKnex);
  await rulePgModel.create(testKnex, pgRule);

  const rule = await rulePgModel.get(testKnex, { name: kinesisRule.name });
  t.teardown(() => rulePgModel.delete(testKnex, rule));

  const [
    consumerEventMappingsBefore,
    logEventMappingsBefore,
  ] = await getKinesisEventMappings();
  t.is(consumerEventMappingsBefore.EventSourceMappings.length, 1);
  t.is(logEventMappingsBefore.EventSourceMappings.length, 1);

  await deleteOldEventSourceMappings(testKnex, ruleWithTrigger);

  const [
    consumerEventMappingsAfter,
    logEventMappingsAfter,
  ] = await getKinesisEventMappings();
  t.is(consumerEventMappingsAfter.EventSourceMappings.length, 0);
  t.is(logEventMappingsAfter.EventSourceMappings.length, 0);
});

test.serial('checkForSnsSubscriptions returns the correct status of a Rule\'s subscription', async (t) => {
  const {
    rulePgModel,
    testKnex,
  } = t.context;

  const topic1 = await awsServices.sns().createTopic({ Name: randomId('topic1_') }).promise();

  const snsRule = fakeRuleFactoryV2({
    workflow,
    rule: {
      type: 'sns',
      value: topic1.TopicArn,
    },
    provider: null,
    collection: null,
    state: 'ENABLED',
  });

  const ruleWithTrigger = await createRuleTrigger(snsRule);
  const pgRule = await translateApiRuleToPostgresRuleRaw(ruleWithTrigger, testKnex);
  const [newPgRule] = await rulePgModel.create(testKnex, pgRule);

  const response = await checkForSnsSubscriptions(ruleWithTrigger);

  t.is(response.subExists, true);
  // Subscription ARN will be different from but include the Topic ARN
  t.true(response.existingSubscriptionArn.includes(topic1.TopicArn));

  t.teardown(() => rulePgModel.delete(testKnex, newPgRule));
});
