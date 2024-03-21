'use strict';

const test = require('ava');
const sinon = require('sinon');
const omit = require('lodash/omit');
const proxyquire = require('proxyquire');
const fs = require('fs-extra');

const {
  CreateEventSourceMappingCommand,
  CreateFunctionCommand,
  DeleteEventSourceMappingCommand,
  GetPolicyCommand,
  ListEventSourceMappingsCommand,
  AddPermissionCommand,
  RemovePermissionCommand,
} = require('@aws-sdk/client-lambda');

const { mockClient } = require('aws-sdk-client-mock');

const awsServices = require('@cumulus/aws-client/services');
const workflows = require('@cumulus/common/workflows');
const Logger = require('@cumulus/logger');

const SQS = require('@cumulus/aws-client/SQS');
const { recursivelyDeleteS3Bucket } = require('@cumulus/aws-client/S3');
const { sqsQueueExists } = require('@cumulus/aws-client/SQS');
const { randomId, randomString } = require('@cumulus/common/test-utils');
const {
  CollectionPgModel,
  destroyLocalTestDb,
  fakeCollectionRecordFactory,
  fakeProviderRecordFactory,
  generateLocalTestDb,
  localStackConnectionEnv,
  migrationDir,
  ProviderPgModel,
  RulePgModel,
  translateApiRuleToPostgresRule,
  translateApiRuleToPostgresRuleRaw,
} = require('@cumulus/db');
const { createSqsQueues, fakeRuleFactoryV2 } = require('../../../lib/testUtils');
const {
  buildPayload,
  deleteKinesisEventSources,
  checkForSnsSubscriptions,
  createRuleTrigger,
  deleteRuleResources,
  updateRuleTrigger,
} = require('../../../lib/rulesHelpers');
const { getSnsTriggerPermissionId } = require('../../../lib/snsRuleHelpers');

const listRulesStub = sinon.stub();

const log = new Logger({ sender: '@cumulus/test-rulesHelpers' });

// TODO remove proxyquire/don't use rulesHelpers require
const rulesHelpers = proxyquire('../../../lib/rulesHelpers', {
  '@cumulus/api-client/rules': {
    listRules: listRulesStub,
  },
  '../lambdas/sf-scheduler': {
    handleScheduleEvent: (payload) => payload,
  },
});

const { ResourceNotFoundError, resourceNotFoundInfo } = require('../../../lib/errors');

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
    return awsServices.lambda().send(new CreateEventSourceMappingCommand(params));
  });
  return await Promise.all(eventSourceMapping);
};

const getKinesisEventMappings = async () => {
  const mappingPromises = eventLambdas.map((lambda) => {
    const mappingParams = { FunctionName: lambda };
    return awsServices.lambda().send(new ListEventSourceMappingsCommand(mappingParams));
  });
  return await Promise.all(mappingPromises);
};

const deleteKinesisEventSourceMappings = async () => {
  const eventMappings = await getKinesisEventMappings();

  if (!eventMappings) {
    return Promise.resolve();
  }

  const allEventMappings = eventMappings[0].EventSourceMappings.concat(
    eventMappings[1].EventSourceMappings
  );

  return await Promise.all(allEventMappings.map((e) =>
    awsServices.lambda().send(new DeleteEventSourceMappingCommand({ UUID: e.UUID }))));
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

  await Promise.all(
    ['messageConsumer', 'KinesisInboundEventLogger'].map(async (name) => {
      const lambdaCreated = await awsServices.lambda().send(new CreateFunctionCommand({
        Code: {
          ZipFile: fs.readFileSync(require.resolve('@cumulus/test-data/fake-lambdas/hello.zip')),
        },
        FunctionName: randomId(name),
        Role: `arn:aws:iam::123456789012:role/${randomId('role')}`,
        Handler: 'index.handler',
        Runtime: 'nodejs16.x',
      }));
      process.env[name] = lambdaCreated.FunctionName;
    })
  );

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
  t.context.providerPgModel = new ProviderPgModel();
  t.context.collectionPgModel = new CollectionPgModel();
});

test.beforeEach(async (t) => {
  t.context.sandbox = sinon.createSandbox();
  const topic = await awsServices.sns().createTopic({ Name: randomId('sns') });
  t.context.snsTopicArn = topic.TopicArn;
  await deleteKinesisEventSourceMappings();
});

test.afterEach.always(async (t) => {
  listRulesStub.reset();
  t.context.sandbox.restore();
  await awsServices.sns().deleteTopic({ TopicArn: t.context.snsTopicArn });
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

test('filterRulesbyCollection logs info when no rules match collection name and version', (t) => {
  const collectionName = randomId('name');
  const collectionVersion = '1.0.0';

  const collection = {
    name: collectionName,
    version: collectionVersion,
  };

  const ruleCollection1Name = randomString(3);
  const ruleCollection1Version = collectionVersion;

  const rule1 = fakeRuleFactoryV2({
    collection: {
      name: ruleCollection1Name,
      version: ruleCollection1Version,
    },
  });

  const logArgs = `Rule collection name - ${ruleCollection1Name} - or Rule collection version - ${ruleCollection1Version} - does not match collection - ${JSON.stringify(collection)}`;
  const logMock = sinon.mock(log).expects('info').withArgs(logArgs).once();
  log.info = logMock;

  t.deepEqual(
    rulesHelpers.filterRulesbyCollection([rule1], collection, log),
    []
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

test.serial('deleteKinesisEventSources throws when deleteKinesisEventSource throws', async (t) => {
  const kinesisArn = `arn:aws:kinesis:us-east-1:000000000000:${randomId('kinesis')}`;
  const {
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
  await t.throwsAsync(
    deleteKinesisEventSources(
      testKnex,
      kinesisRule,
      {
        deleteKinesisEventSourceMethod: () => {
          throw new Error('Test Error');
        },
      },
      { message: 'Test Error' }
    )
  );
});

test.serial('deleteKinesisEventSources does not throw when deleteKinesisEventSource throws a ResourceNotFoundException', async (t) => {
  const kinesisArn = `arn:aws:kinesis:us-east-1:000000000000:${randomId('kinesis')}`;
  const {
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
  class ResourceNotFoundException extends Error {
    constructor(...args) {
      super(...args);
      this.name = 'ResourceNotFoundException';
    }
  }
  const deleteResult = await deleteKinesisEventSources(testKnex, kinesisRule, {
    // eslint-disable-next-line require-await
    deleteKinesisEventSourceMethod: async () => {
      throw new ResourceNotFoundException('Test Error');
    },
  });
  t.deepEqual(deleteResult, [undefined, undefined]);
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
  const lambdaMock = mockClient(awsServices.lambda());
  lambdaMock.onAnyCommand().rejects();
  lambdaMock.on(RemovePermissionCommand).resolves({});
  lambdaMock.on(AddPermissionCommand).resolves({});
  const snsStub = sinon.stub(awsServices, 'sns')
    .returns({
      listSubscriptionsByTopic: () => (
        Promise.resolve({
          Subscriptions: [{
            Endpoint: process.env.messageConsumer,
            SubscriptionArn: randomString(),
          }],
        })
      ),
      unsubscribe: () => (
        Promise.resolve()
      ),
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
    lambdaMock.restore();
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
  const name = `${process.env.stackName}-${scheduledRule.name}`;
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
  const lambdaMock = mockClient(awsServices.lambda());
  lambdaMock.onAnyCommand().rejects();
  lambdaMock.on(RemovePermissionCommand).resolves();
  lambdaMock.on(AddPermissionCommand).resolves();
  const snsStub = sinon.stub(awsServices, 'sns')
    .returns({
      listSubscriptionsByTopic: () => (
        Promise.resolve({
          Subscriptions: [{
            Endpoint: process.env.messageConsumer,
            SubscriptionArn: randomString(),
          }],
        })
      ),
      unsubscribe: () => (
        Promise.resolve()
      ),
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
    lambdaMock.restore();
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
      (queueUrl) => awsServices.sqs().deleteQueue({ QueueUrl: queueUrl })
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

test.serial('deleteRuleResources() removes SNS source mappings and permissions', async (t) => {
  const {
    rulePgModel,
    testKnex,
  } = t.context;

  const topic1 = await awsServices.sns().createTopic({ Name: randomId('topic1_') });

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

  const { Policy } = await awsServices.lambda().send(new GetPolicyCommand({
    FunctionName: process.env.messageConsumer,
  }));
  const { Statement } = JSON.parse(Policy);
  t.true(Statement.some((s) => s.Sid === getSnsTriggerPermissionId(ruleWithTrigger)));

  await deleteRuleResources(testKnex, ruleWithTrigger);

  const { subExists: subExists2 } = await checkForSnsSubscriptions(ruleWithTrigger);
  t.false(subExists2);

  await t.throwsAsync(
    awsServices.lambda().send(new GetPolicyCommand({
      FunctionName: process.env.messageConsumer,
    })),
    { name: 'ResourceNotFoundException' }
  );
  t.teardown(() => rulePgModel.delete(testKnex, newPgRule));
});

test.serial('deleteRuleResources() does not throw if a rule is passed in without a valid SNS subscription', async (t) => {
  const {
    testKnex,
  } = t.context;

  const topic1 = await awsServices.sns().createTopic({ Name: randomId('topic1_') });

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
  const origSnsCheck = await checkForSnsSubscriptions(ruleWithTrigger);
  t.true(origSnsCheck.subExists);

  await awsServices.sns().unsubscribe({ SubscriptionArn: ruleWithTrigger.rule.arn });
  const snsCheck = await checkForSnsSubscriptions(ruleWithTrigger);
  t.false(snsCheck.subExists);
  await t.notThrowsAsync(deleteRuleResources(testKnex, ruleWithTrigger));
});

test.serial('deleteRuleResources() removes kinesis source mappings', async (t) => {
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

  await deleteRuleResources(testKnex, ruleWithTrigger);

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

  const topic1 = await awsServices.sns().createTopic({ Name: randomId('topic1_') });

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

test.serial('disabling an SNS rule removes the event source mapping', async (t) => {
  const {
    snsTopicArn,
    testKnex,
  } = t.context;

  const item = fakeRuleFactoryV2({
    workflow,
    rule: {
      type: 'sns',
      value: snsTopicArn,
    },
    state: 'ENABLED',
  });

  const ruleWithTrigger = await rulesHelpers.createRuleTrigger(item);

  t.is(ruleWithTrigger.rule.value, snsTopicArn);
  t.truthy(ruleWithTrigger.rule.arn);
  t.is(ruleWithTrigger.state, 'ENABLED');

  const updates = { ...ruleWithTrigger, state: 'DISABLED' };
  const ruleWithUpdatedTrigger = await rulesHelpers.updateRuleTrigger(
    ruleWithTrigger,
    updates,
    testKnex
  );

  t.is(ruleWithUpdatedTrigger.name, ruleWithTrigger.name);
  t.is(ruleWithUpdatedTrigger.state, 'DISABLED');
  t.is(ruleWithUpdatedTrigger.rule.type, ruleWithTrigger.rule.type);
  t.is(ruleWithUpdatedTrigger.rule.value, ruleWithTrigger.rule.value);
  t.falsy(ruleWithUpdatedTrigger.rule.arn);
});

test.serial('deleting an SNS rule updates the event source mapping', async (t) => {
  const {
    snsTopicArn,
    testKnex,
  } = t.context;

  const unsubscribeSpy = sinon.spy(awsServices.sns(), 'unsubscribe');

  const item = fakeRuleFactoryV2({
    workflow,
    rule: {
      type: 'sns',
      value: snsTopicArn,
    },
    state: 'ENABLED',
  });

  const ruleWithTrigger = await rulesHelpers.createRuleTrigger(item);

  t.is(ruleWithTrigger.rule.value, snsTopicArn);

  await rulesHelpers.deleteRuleResources(testKnex, ruleWithTrigger);

  t.true(unsubscribeSpy.called);
  t.true(unsubscribeSpy.calledWith({
    SubscriptionArn: ruleWithTrigger.rule.arn,
  }));

  t.teardown(() => {
    unsubscribeSpy.restore();
  });
});

test.serial('Multiple rules using same SNS topic can be created and deleted', async (t) => {
  const {
    collectionPgModel,
    providerPgModel,
    testKnex,
    rulePgModel,
  } = t.context;
  const testPgProvider = fakeProviderRecordFactory();
  await providerPgModel.create(
    testKnex,
    testPgProvider,
    '*'
  );

  const testPgCollection1 = fakeCollectionRecordFactory({
    name: randomId('collection-'),
    version: 'v1',
  });
  const testPgCollection2 = fakeCollectionRecordFactory({
    name: randomId('collection-'),
    version: 'v2',
  });
  await Promise.all([
    collectionPgModel.create(
      testKnex,
      testPgCollection1,
      '*'
    ),
    collectionPgModel.create(
      testKnex,
      testPgCollection2,
      '*'
    ),
  ]);
  const unsubscribeSpy = sinon.spy(awsServices.sns(), 'unsubscribe');
  const { TopicArn } = await awsServices.sns().createTopic({
    Name: randomId('topic'),
  });

  const ruleWithTrigger = await rulesHelpers.createRuleTrigger(fakeRuleFactoryV2({
    name: randomId('rule1'),
    rule: {
      type: 'sns',
      value: TopicArn,
    },
    workflow,
    state: 'ENABLED',
    collection: {
      name: testPgCollection1.name,
      version: testPgCollection1.version,
    },
    provider: testPgProvider.name,
  }));
  const ruleWithTrigger2 = await rulesHelpers.createRuleTrigger(fakeRuleFactoryV2({
    name: randomId('rule2'),
    rule: {
      type: 'sns',
      value: TopicArn,
    },
    workflow,
    state: 'ENABLED',
    collection: {
      name: testPgCollection2.name,
      version: testPgCollection2.version,
    },
    provider: testPgProvider.name,
  }));

  const pgRule = await translateApiRuleToPostgresRule(ruleWithTrigger, testKnex);
  const pgRule2 = await translateApiRuleToPostgresRule(ruleWithTrigger2, testKnex);

  const [rule1] = await rulePgModel.create(testKnex, pgRule);
  const [rule2] = await rulePgModel.create(testKnex, pgRule2);

  // rules share the same subscription
  t.is(rule1.arn, rule2.arn);

  // Have to delete rules serially otherwise all rules still exist
  // when logic to check for shared source mapping is evaluated

  await rulesHelpers.deleteSnsTrigger(testKnex, ruleWithTrigger);
  await rulePgModel.delete(testKnex, rule1);

  await t.notThrowsAsync(rulesHelpers.deleteSnsTrigger(testKnex, ruleWithTrigger2));
  await rulePgModel.delete(testKnex, rule2);

  // Ensure that cleanup for SNS rule subscription was actually called
  t.true(unsubscribeSpy.called);
  t.true(unsubscribeSpy.calledWith({
    SubscriptionArn: ruleWithTrigger.rule.arn,
  }));

  t.teardown(async () => {
    unsubscribeSpy.restore();
    await awsServices.sns().deleteTopic({
      TopicArn,
    });
  });
});

test.serial('deleteSnsTrigger throws more detailed ResourceNotFoundError', async (t) => {
  const errorMessage = 'Resource is not found in resource policy.';
  const error = new Error(errorMessage);
  error.name = 'ResourceNotFoundException';
  const { snsTopicArn } = t.context;

  const ruleWithTrigger = await rulesHelpers.createRuleTrigger(fakeRuleFactoryV2({
    rule: {
      type: 'sns',
      value: snsTopicArn,
    },
    workflow,
    state: 'ENABLED',
  }));

  const lambdaStub = sinon.stub(awsServices.lambda(), 'send');
  lambdaStub.throws(error);

  await t.throwsAsync(
    rulesHelpers.deleteSnsTrigger(t.context.testKnex, ruleWithTrigger),
    {
      instanceOf: ResourceNotFoundError,
      message: `${errorMessage} ${resourceNotFoundInfo}`,
    }
  );

  t.teardown(() => {
    lambdaStub.restore();
  });
});

// ***Create Rules Resource Tests
test('Creating a rule trigger defaults enabled to true', async (t) => {
  const rule = fakeRuleFactoryV2({
    rule: {
      type: 'onetime',
    },
    workflow,
  });
  // remove enabled from rule to be created
  delete rule.state;

  // create rule trigger
  const ruleWithTrigger = await createRuleTrigger(rule);

  t.is(ruleWithTrigger.state, 'ENABLED');
});

test('Creating an invalid rule does not create workflow triggers', async (t) => {
  const rule = fakeRuleFactoryV2({
    rule: {
      type: 'onetime',
    },
    workflow,
    state: 'ENABLED',
  });
  rule.rule.type = 'invalid';

  await t.throwsAsync(
    () => createRuleTrigger(rule),
    { name: 'SchemaValidationError' }
  );
});

test('Creating a rule trigger for a onetime rule succeeds', async (t) => {
  const rule = fakeRuleFactoryV2({
    workflow,
    rule: {
      type: 'onetime',
    },
    state: 'ENABLED',
    meta: {
      visibilityTimeout: 100,
      retries: 4,
    },
  });

  const onetimeRule = await createRuleTrigger(rule);

  t.deepEqual(onetimeRule, rule);
});

test('Creating a rule trigger for a onetime rule with a DISABLED state is DISABLED and does not execute the rule', async (t) => {
  const rule = fakeRuleFactoryV2({
    workflow,
    rule: {
      type: 'onetime',
    },
    state: 'DISABLED',
    meta: {
      visibilityTimeout: 100,
      retries: 4,
    },
  });

  const testOneTimeRuleParams = {
    invokeMethod: sinon.stub(),
  };

  const onetimeRule = await createRuleTrigger(rule, testOneTimeRuleParams);
  t.false(testOneTimeRuleParams.invokeMethod.called);
  t.deepEqual(onetimeRule, rule);
});

test.serial('Creating rule triggers for a kinesis type rule adds event mappings', async (t) => {
  const kinesisArn = `arn:aws:kinesis:us-east-1:000000000000:${randomId('kinesis')}`;
  const kinesisRule = fakeRuleFactoryV2({
    workflow,
    state: 'ENABLED',
    rule: {
      type: 'kinesis',
      value: kinesisArn,
    },
  });
  // create rule
  const createdRule = await createRuleTrigger(kinesisRule);
  const kinesisEventMappings = await getKinesisEventMappings();
  const consumerEventMappings = kinesisEventMappings[0].EventSourceMappings;
  const logEventMappings = kinesisEventMappings[1].EventSourceMappings;

  t.is(consumerEventMappings.length, 1);
  t.is(logEventMappings.length, 1);
  t.is(consumerEventMappings[0].UUID, createdRule.rule.arn);
  t.is(logEventMappings[0].UUID, createdRule.rule.logEventArn);

  t.is(createdRule.name, kinesisRule.name);
  t.is(createdRule.rule.value, kinesisRule.rule.value);
  t.false(createdRule.rule.arn === undefined);
  t.false(createdRule.rule.logEventArn === undefined);
});

test.serial('Repeatedly creating rule triggers for a kinesis type rule utilizes the same event mappings', async (t) => {
  const kinesisArn = `arn:aws:kinesis:us-east-1:000000000000:${randomId('kinesis')}`;
  const kinesisRule = fakeRuleFactoryV2({
    workflow,
    state: 'ENABLED',
    rule: {
      type: 'kinesis',
      value: kinesisArn,
    },
  });
  // create rule
  const originalCreatedRule = await createRuleTrigger(kinesisRule);
  await createRuleTrigger(kinesisRule);

  const kinesisEventMappings = await getKinesisEventMappings();
  const consumerEventMappings = kinesisEventMappings[0].EventSourceMappings;
  const logEventMappings = kinesisEventMappings[1].EventSourceMappings;

  t.is(consumerEventMappings.length, 1);
  t.is(logEventMappings.length, 1);
  t.is(consumerEventMappings[0].UUID, originalCreatedRule.rule.arn);
  t.is(logEventMappings[0].UUID, originalCreatedRule.rule.logEventArn);

  t.is(originalCreatedRule.name, kinesisRule.name);
  t.is(originalCreatedRule.rule.value, kinesisRule.rule.value);
  t.false(originalCreatedRule.rule.arn === undefined);
  t.false(originalCreatedRule.rule.logEventArn === undefined);
});

test.serial('Recreating rule triggers for a kinesis type rule over a disabled rule utilizes the same event mappings', async (t) => {
  const kinesisArn = `arn:aws:kinesis:us-east-1:000000000000:${randomId('kinesis')}`;
  const kinesisRule = fakeRuleFactoryV2({
    workflow,
    state: 'ENABLED',
    rule: {
      type: 'kinesis',
      value: kinesisArn,
    },
  });

  // Create rule triggers
  const originalCreatedRule = await createRuleTrigger(kinesisRule);
  const originalKinesisEventMappings = await getKinesisEventMappings();
  // Set event mapping to disabled
  originalKinesisEventMappings.map((mapping) =>
    awsServices
      .lambda()
      .updateEventSourceMapping({
        UUID: mapping.EventSourceMappings[0].UUID,
        Enabled: false,
      }));

  // Recreate rule triggers
  await createRuleTrigger(kinesisRule);
  const kinesisEventMappings = await getKinesisEventMappings();
  const consumerEventMappings = kinesisEventMappings[0].EventSourceMappings;
  const logEventMappings = kinesisEventMappings[1].EventSourceMappings;

  t.is(consumerEventMappings.length, 1);
  t.is(logEventMappings.length, 1);
  t.is(consumerEventMappings[0].UUID, originalCreatedRule.rule.arn);
  t.is(logEventMappings[0].UUID, originalCreatedRule.rule.logEventArn);

  t.is(originalCreatedRule.name, kinesisRule.name);
  t.is(originalCreatedRule.rule.value, kinesisRule.rule.value);
  t.false(originalCreatedRule.rule.arn === undefined);
  t.false(originalCreatedRule.rule.logEventArn === undefined);
});

test.serial('Creating an invalid kinesis type rule does not add event mappings', async (t) => {
  const kinesisRule = fakeRuleFactoryV2({
    workflow,
    state: 'ENABLED',
    rule: {
      type: 'kinesis',
      value: randomString(),
    },
  });
  delete kinesisRule.name;
  await t.throwsAsync(createRuleTrigger(kinesisRule), { name: 'SchemaValidationError' });

  const kinesisEventMappings = await getKinesisEventMappings();
  const consumerEventMappings = kinesisEventMappings[0].EventSourceMappings;
  const logEventMappings = kinesisEventMappings[1].EventSourceMappings;

  t.is(consumerEventMappings.length, 0);
  t.is(logEventMappings.length, 0);
});

test('Creating a rule trigger SQS rule fails if queue does not exist', async (t) => {
  const rule = fakeRuleFactoryV2({
    rule: {
      type: 'sqs',
      value: 'non-existent-queue',
    },
    workflow,
    state: 'ENABLED',
  });
  await t.throwsAsync(
    createRuleTrigger(rule),
    { message: /SQS queue non-existent-queue does not exist/ }
  );
});

test('Creating a rule trigger for an SQS rule fails if there is no redrive policy on the queue', async (t) => {
  const queueUrl = await SQS.createQueue(randomId('queue'));
  const rule = fakeRuleFactoryV2({
    workflow,
    rule: {
      type: 'sqs',
      value: queueUrl,
    },
    state: 'ENABLED',
  });
  await t.throwsAsync(
    createRuleTrigger(rule),
    { message: `SQS queue ${queueUrl} does not have a dead-letter queue configured` }
  );
  t.teardown(async () => await SQS.deleteQueue(queueUrl));
});

test('Creating a rule trigger for an SQS rule succeeds', async (t) => {
  const queues = await createSqsQueues(randomString());
  const rule = fakeRuleFactoryV2({
    workflow,
    rule: {
      type: 'sqs',
      value: queues.queueUrl,
    },
    state: 'ENABLED',
    meta: {
      visibilityTimeout: 100,
      retries: 4,
    },
  });
  const sqsRule = await createRuleTrigger(rule);
  t.deepEqual(sqsRule, rule);
  t.teardown(async () => await SQS.deleteQueue(queues.queueUrl));
});

test('Creating a rule trigger for an SQS rule succeeds and allows 0 retries and 0 visibilityTimeout', async (t) => {
  const queues = await createSqsQueues(randomString());
  const rule = fakeRuleFactoryV2({
    workflow,
    rule: {
      type: 'sqs',
      value: queues.queueUrl,
    },
    state: 'ENABLED',
    meta: {
      visibilityTimeout: 0,
      retries: 0,
    },
  });
  const sqsRule = await createRuleTrigger(rule);
  t.deepEqual(sqsRule, rule);
  t.teardown(async () => await SQS.deleteQueue(queues.queueUrl));
});

test('Creating a rule trigger for an SQS rule succeeds and sets default value for meta.retries and visibilityTimeout', async (t) => {
  const queues = await createSqsQueues(randomString());
  const rule = fakeRuleFactoryV2({
    workflow,
    rule: {
      type: 'sqs',
      value: queues.queueUrl,
    },
    state: 'ENABLED',
  });
  const sqsRule = await createRuleTrigger(rule);
  t.is(sqsRule.meta.retries, 3);
  t.is(sqsRule.meta.visibilityTimeout, 300);
  t.teardown(async () => await SQS.deleteQueue(queues.queueUrl));
});

test('Creating a rule trigger for a rule without a type fails', async (t) => {
  const rule = fakeRuleFactoryV2({
    rule: {
      type: 'onetime',
    },
    workflow,
    state: 'ENABLED',
  });
  delete rule.rule.type;

  await t.throwsAsync(
    () => createRuleTrigger(rule),
    { name: 'SchemaValidationError' }
  );
});

test('Creating a rule trigger for a rule without a workflow fails', async (t) => {
  const rule = fakeRuleFactoryV2({
    rule: {
      type: 'onetime',
    },
    workflow,
    state: 'ENABLED',
  });
  delete rule.workflow;

  await t.throwsAsync(
    () => createRuleTrigger(rule),
    { name: 'SchemaValidationError' }
  );
});

test('Creating a rule trigger for a rule without a name fails', async (t) => {
  const rule = fakeRuleFactoryV2({
    rule: {
      type: 'onetime',
    },
    workflow,
    state: 'ENABLED',
  });
  delete rule.name;

  await t.throwsAsync(
    () => createRuleTrigger(rule),
    { name: 'SchemaValidationError' }
  );
});

test('Creating a disabled SNS rule creates no event source mapping', async (t) => {
  const snsTopicArn = randomString();
  const item = fakeRuleFactoryV2({
    workflow,
    rule: {
      type: 'sns',
      value: snsTopicArn,
    },
    state: 'DISABLED',
  });

  const rule = await createRuleTrigger(item);

  t.is(rule.state, 'DISABLED');
  t.is(rule.rule.value, snsTopicArn);
  t.falsy(rule.rule.arn);
});

test.serial('Creating an enabled SNS rule creates an event source mapping', async (t) => {
  const { TopicArn } = await awsServices.sns().createTopic({
    Name: randomId('topic'),
  });
  const snsStub = sinon.stub(awsServices, 'sns')
    .returns({
      listSubscriptionsByTopic: () => (
        Promise.resolve({
          Subscriptions: [{
            SubscriptionArn: randomString(),
          }],
        })
      ),
      subscribe: () => (
        Promise.resolve({
          SubscriptionArn: randomString(),
        })
      ),
    });

  const rule = fakeRuleFactoryV2({
    rule: {
      type: 'sns',
      value: TopicArn,
    },
    workflow,
    state: 'ENABLED',
  });
  const subscribeSpy = sinon.spy(awsServices.sns(), 'subscribe');

  const lambdaMock = mockClient(awsServices.lambda());
  let mockCalled = false;
  lambdaMock.onAnyCommand().rejects();
  lambdaMock.on(AddPermissionCommand).callsFake(() => {
    mockCalled = true;
  });

  await createRuleTrigger(rule);
  t.true(subscribeSpy.called);
  t.true(subscribeSpy.calledWith({
    TopicArn: rule.rule.value,
    Protocol: 'lambda',
    Endpoint: process.env.messageConsumer,
    ReturnSubscriptionArn: true,
  }));
  t.true(mockCalled);
  t.teardown(async () => {
    snsStub.restore();
    subscribeSpy.restore();
    lambdaMock.restore();
    await awsServices.sns().deleteTopic({ TopicArn });
  });
});

test.serial('Creating a rule trigger for a scheduled rule succeeds', async (t) => {
  const rule = fakeRuleFactoryV2({
    workflow,
    rule: {
      type: 'scheduled',
      value: 'rate(1 min)',
    },
    state: 'ENABLED',
    meta: {
      visibilityTimeout: 100,
      retries: 4,
    },
  });

  const cloudwatchStub = sinon.stub(awsServices, 'cloudwatchevents')
    .returns({
      putRule: () => ({
        promise: () => Promise.resolve(),
      }),
      putTargets: () => ({
        promise: () => Promise.resolve(),
      }),
    });
  const scheduledRule = await createRuleTrigger(rule);
  t.true(cloudwatchStub.called);
  t.deepEqual(scheduledRule, rule);
  t.teardown(() => {
    cloudwatchStub.restore();
  });
});

test('buildPayload builds a lambda payload from the rule', async (t) => {
  const collectionPgModel = new CollectionPgModel();
  const providerPgModel = new ProviderPgModel();
  const testPgProvider = fakeProviderRecordFactory();
  const [pgProvider] = await providerPgModel.create(
    t.context.testKnex,
    testPgProvider,
    '*'
  );
  const collectionName = 'fakeCollection';
  const collectionVersion = 'v1';
  const testPgCollection = fakeCollectionRecordFactory({
    name: collectionName,
    version: collectionVersion,
  });
  const [pgCollection] = await collectionPgModel.create(
    t.context.testKnex,
    testPgCollection
  );
  const ruleParams = {
    rule: { type: 'onetime' },
    workflow,
    meta: {
      visibilityTimeout: 100,
      retries: 4,
    },
    cumulus_meta: {
      execution_name: 'fakeName',
    },
    payload: {
      input: 'test',
    },
    queueUrl: randomString(),
    executionNamePrefix: randomString(),
    asyncOperationId: randomString(),
    provider: pgProvider.name,
    collection: { name: pgCollection.name, version: pgCollection.version },
  };
  const rule = fakeRuleFactoryV2(ruleParams);
  const expectedPayload = {
    provider: pgProvider.name,
    collection: { name: pgCollection.name, version: pgCollection.version },
    meta: rule.meta,
    cumulus_meta: { execution_name: rule.cumulus_meta.execution_name },
    payload: rule.payload,
    queueUrl: rule.queueUrl,
    executionNamePrefix: rule.executionNamePrefix,
    asyncOperationId: rule.asyncOperationId,
  };
  const payload = await buildPayload(rule, ruleParams.cumulus_meta, ruleParams.asyncOperationId);
  t.deepEqual(omit(payload, ['template', 'definition']), expectedPayload);
});

test('buildPayload throws error if workflow file does not exist', async (t) => {
  const fakeWorkflow = randomString();
  const workflowFileKey = workflows.getWorkflowFileKey(process.env.stackName, fakeWorkflow);
  const ruleParams = {
    rule: { type: 'onetime' },
    workflow: fakeWorkflow,
  };
  const rule = fakeRuleFactoryV2(ruleParams);
  await t.throwsAsync(
    buildPayload(rule),
    { message: `Workflow doesn\'t exist: s3://${process.env.system_bucket}/${workflowFileKey} for ${rule.name}` }
  );
});

test.serial('Updating a rule trigger with an "onetime" rule type returns updated rule', async (t) => {
  const fakeRule = fakeRuleFactoryV2({
    workflow,
    state: 'ENABLED',
    rule: {
      type: 'onetime',
      value: 'testField',
    },
  });
  // create rule trigger
  const createdRule = await createRuleTrigger(fakeRule);
  const updatedRule = {
    ...createdRule,
    rule: {
      type: 'onetime',
      value: 'newTestField',
    },
  };
  const updatedRuleTriggerOutput = await updateRuleTrigger(createdRule, updatedRule);
  t.deepEqual(updatedRuleTriggerOutput, updatedRule);
});

test.serial('Updating a rule trigger with an invalid rule type throws an error', async (t) => {
  const fakeRule = fakeRuleFactoryV2({
    workflow,
    state: 'ENABLED',
    rule: {
      type: 'totallyNotARule',
    },
  });
  // create rule trigger
  await t.throwsAsync(createRuleTrigger(fakeRule), { name: 'SchemaValidationError' });
});

// update rule resources tests
test.serial('Updating a kinesis type rule workflow does not affect value or event source mappings', async (t) => {
  const kinesisArn = `arn:aws:kinesis:us-east-1:000000000000:${randomId('kinesis')}`;
  const { testKnex } = t.context;
  const kinesisRule = fakeRuleFactoryV2({
    workflow,
    state: 'ENABLED',
    rule: {
      type: 'kinesis',
      value: kinesisArn,
    },
  });
  // create rule trigger
  const createdRule = await createRuleTrigger(kinesisRule);
  const kinesisEventMappings = await getKinesisEventMappings();
  const consumerEventMappings = kinesisEventMappings[0].EventSourceMappings;
  const logEventMappings = kinesisEventMappings[1].EventSourceMappings;

  t.is(consumerEventMappings.length, 1);
  t.is(logEventMappings.length, 1);
  t.is(consumerEventMappings[0].UUID, createdRule.rule.arn);
  t.is(logEventMappings[0].UUID, createdRule.rule.logEventArn);

  // update rule workflow
  const updatedKinesisRule = {
    ...createdRule,
    workflow: 'new-workflow',
  };
  const updatedRule = await updateRuleTrigger(kinesisRule, updatedKinesisRule, testKnex);
  const updatedKinesisEventMappings = await getKinesisEventMappings();
  const updatedconsumerEventMappings = updatedKinesisEventMappings[0].EventSourceMappings;
  const updatedlogEventMappings = updatedKinesisEventMappings[1].EventSourceMappings;

  t.is(updatedconsumerEventMappings.length, 1);
  t.is(updatedlogEventMappings.length, 1);
  t.is(updatedconsumerEventMappings[0].UUID, updatedRule.rule.arn);
  t.is(updatedlogEventMappings[0].UUID, updatedRule.rule.logEventArn);

  t.is(createdRule.rule.arn, updatedRule.rule.arn);
  t.is(createdRule.rule.logEventArn, updatedRule.rule.logEventArn);

  // Clean Up
  t.teardown(async () => {
    await deleteRuleResources(testKnex, updatedRule);
  });
});

test.serial('Updating a kinesis type rule workflow with new arn updates event source mappings', async (t) => {
  const kinesisArn = `arn:aws:kinesis:us-east-1:000000000000:${randomId('kinesis')}`;
  const updatedKinesisArn = `arn:aws:kinesis:us-east-1:000000000000:${randomId('kinesis')}`;
  const { testKnex } = t.context;
  const kinesisRule = fakeRuleFactoryV2({
    workflow,
    state: 'ENABLED',
    rule: {
      type: 'kinesis',
      value: kinesisArn,
    },
  });
  // create rule trigger
  const createdRule = await createRuleTrigger(kinesisRule);
  const kinesisEventMappings = await getKinesisEventMappings();
  const consumerEventMappings = kinesisEventMappings[0].EventSourceMappings;
  const logEventMappings = kinesisEventMappings[1].EventSourceMappings;

  t.is(consumerEventMappings.length, 1);
  t.is(logEventMappings.length, 1);
  t.is(consumerEventMappings[0].UUID, createdRule.rule.arn);
  t.is(logEventMappings[0].UUID, createdRule.rule.logEventArn);

  // update rule workflow
  const updatedKinesisRule = {
    ...createdRule,
    workflow: 'new-workflow',
    rule: { ...createdRule.rule, value: updatedKinesisArn },
  };
  const updatedRule = await updateRuleTrigger(kinesisRule, updatedKinesisRule, testKnex);
  const updatedKinesisEventMappings = await getKinesisEventMappings();
  const updatedconsumerEventMappings = updatedKinesisEventMappings[0].EventSourceMappings;
  const updatedlogEventMappings = updatedKinesisEventMappings[1].EventSourceMappings;

  t.is(updatedconsumerEventMappings.length, 2);
  t.is(updatedlogEventMappings.length, 2);

  t.is(updatedconsumerEventMappings[1].UUID, updatedRule.rule.arn);
  t.is(updatedlogEventMappings[1].UUID, updatedRule.rule.logEventArn);
  t.is(updatedconsumerEventMappings[0].UUID, createdRule.rule.arn);
  t.is(updatedlogEventMappings[0].UUID, createdRule.rule.logEventArn);

  // Clean Up
  t.teardown(async () => {
    await deleteRuleResources(testKnex, createdRule);
    await deleteRuleResources(testKnex, updatedRule);
  });
});

test.serial('Updating a valid SQS rule to have an invalid schema throws an error', async (t) => {
  const queues = await createSqsQueues(randomString());
  const sqsRule = fakeRuleFactoryV2({
    workflow,
    rule: {
      type: 'sqs',
      value: queues.queueUrl,
    },
    state: 'ENABLED',
    meta: {
      visibilityTimeout: 100,
      retries: 4,
    },
  });
  const sqsRuleWithTrigger = await createRuleTrigger(sqsRule);
  t.is(sqsRuleWithTrigger.value, sqsRule.value);

  // update rule to be invalid by setting type to null
  const updatedSqsRule = {
    ...sqsRuleWithTrigger,
    rule: {
      ...sqsRuleWithTrigger.rule,
      type: null,
    },
  };
  await t.throwsAsync(
    updateRuleTrigger(sqsRuleWithTrigger, updatedSqsRule, t.context.testKnex),
    { name: 'SchemaValidationError' }
  );
  t.teardown(async () => {
    await deleteRuleResources(t.context.testKnex, sqsRuleWithTrigger);
    await SQS.deleteQueue(queues.queueUrl);
  });
});

test.serial('Updating an SQS rule fails if there is no redrive policy on the queue', async (t) => {
  const queues = await createSqsQueues(randomString());
  const rule = fakeRuleFactoryV2({
    workflow,
    rule: {
      type: 'sqs',
      value: queues.queueUrl,
    },
    state: 'ENABLED',
    meta: {
      visibilityTimeout: 100,
      retries: 4,
    },
  });
  const sqsRule = await createRuleTrigger(rule);
  const queueUrl = await SQS.createQueue(randomId('queue'));
  const updatedRule = {
    ...rule,
    rule: {
      ...rule.rule,
      value: queueUrl,
    },
  };
  await t.throwsAsync(
    updateRuleTrigger(sqsRule, updatedRule, t.context.testKnex),
    { message: `SQS queue ${queueUrl} does not have a dead-letter queue configured` }
  );
  t.teardown(async () => await SQS.deleteQueue(queueUrl));
});

test.serial('Updating the queue for an SQS rule succeeds', async (t) => {
  const queues = await createSqsQueues(randomString());
  const rule = fakeRuleFactoryV2({
    workflow,
    state: 'ENABLED',
    rule: {
      type: 'sqs',
      value: queues.queueUrl,
    },
    meta: {
      visibilityTimeout: 100,
      retries: 4,
    },
  });
  const sqsRule = await createRuleTrigger(rule);
  t.is(sqsRule.rule.value, queues.queueUrl);
  t.deepEqual(sqsRule.meta, rule.meta);

  const newQueues = await createSqsQueues(randomString(), 2, '200');
  const updatedRule = {
    ...omit(sqsRule, ['meta']),
    rule: {
      ...rule.rule,
      value: newQueues.queueUrl,
    },
  };
  const updatedSqsRule = await updateRuleTrigger(sqsRule, updatedRule, t.context.testKnex);
  t.is(updatedSqsRule.rule.value, newQueues.queueUrl);
  t.deepEqual(updatedSqsRule.meta, { visibilityTimeout: 200, retries: 3 });
  t.teardown(async () => {
    await SQS.deleteQueue(queues.queueUrl);
    await SQS.deleteQueue(newQueues.queueUrl);
  });
});

test.serial('Updating the queue for an SQS rule succeeds and allows 0 retries and 0 visibilityTimeout', async (t) => {
  const queues = await createSqsQueues(randomString());
  const rule = fakeRuleFactoryV2({
    workflow,
    state: 'ENABLED',
    rule: {
      type: 'sqs',
      value: queues.queueUrl,
    },
    meta: {
      visibilityTimeout: 100,
      retries: 4,
    },
  });
  const sqsRule = await createRuleTrigger(rule);
  t.is(sqsRule.rule.value, queues.queueUrl);
  t.deepEqual(sqsRule.meta, rule.meta);

  const newQueues = await createSqsQueues(randomString(), 2, '200');
  const updatedRule = {
    ...sqsRule,
    rule: {
      ...rule.rule,
      value: newQueues.queueUrl,
    },
    meta: {
      visibilityTimeout: 0,
      retries: 0,
    },
  };
  const updatedSqsRule = await updateRuleTrigger(sqsRule, updatedRule, t.context.testKnex);
  t.is(updatedSqsRule.rule.value, newQueues.queueUrl);
  t.deepEqual(updatedSqsRule.meta, updatedRule.meta);
  t.teardown(async () => {
    await SQS.deleteQueue(queues.queueUrl);
    await SQS.deleteQueue(newQueues.queueUrl);
  });
});

test.serial('Updating an SNS rule updates the event source mapping', async (t) => {
  const snsTopicArn = randomString();
  const newSnsTopicArn = randomString();
  const { TopicArn } = await awsServices.sns().createTopic({
    Name: snsTopicArn,
  });
  const { TopicArn: TopicArn2 } = await awsServices.sns().createTopic({
    Name: newSnsTopicArn,
  });

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
      listSubscriptionsByTopic: () => (
        Promise.resolve({
          Subscriptions: [{
            Endpoint: process.env.messageConsumer,
            SubscriptionArn: randomString(),
          }],
        })
      ),
      unsubscribe: () => (
        Promise.resolve()
      ),
    });

  const rule = fakeRuleFactoryV2({
    rule: {
      type: 'sns',
      value: TopicArn,
    },
    workflow,
    state: 'ENABLED',
  });

  const ruleWithTrigger = await createRuleTrigger(rule);

  t.is(ruleWithTrigger.rule.value, TopicArn);
  t.truthy(ruleWithTrigger.rule.arn);

  const updates = {
    ...rule,
    rule: {
      ...rule.rule,
      arn: ruleWithTrigger.rule.arn,
      value: TopicArn2,
    },
  };
  const updatedSnsRule = await updateRuleTrigger(ruleWithTrigger, updates, t.context.testKnex);

  t.is(updatedSnsRule.name, rule.name);
  t.is(updatedSnsRule.rule.type, rule.rule.type);
  t.is(updatedSnsRule.rule.value, TopicArn2);
  t.not(updatedSnsRule.rule.arn, rule.rule.arn);

  t.teardown(async () => {
    lambdaStub.restore();
    snsStub.restore();
    await awsServices.sns().deleteTopic({ TopicArn: TopicArn2 });
  });
});

test.serial('Updating an SNS rule to "disabled" removes the event source mapping ARN', async (t) => {
  const snsTopicArn = randomString();
  const { TopicArn } = await awsServices.sns().createTopic({
    Name: snsTopicArn,
  });

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
      listSubscriptionsByTopic: () => (
        Promise.resolve({
          Subscriptions: [{
            Endpoint: process.env.messageConsumer,
            SubscriptionArn: randomString(),
          }],
        })
      ),
      unsubscribe: () => (
        Promise.resolve()
      ),
    });

  const rule = fakeRuleFactoryV2({
    rule: {
      type: 'sns',
      value: TopicArn,
    },
    workflow,
    state: 'ENABLED',
  });

  const ruleWithTrigger = await createRuleTrigger(rule);

  t.is(ruleWithTrigger.rule.value, TopicArn);
  t.truthy(ruleWithTrigger.rule.arn);

  const updates = {
    ...ruleWithTrigger,
    state: 'DISABLED',
  };
  const updatedSnsRule = await updateRuleTrigger(ruleWithTrigger, updates, t.context.testKnex);

  t.true(Object.prototype.hasOwnProperty.call(updatedSnsRule.rule, 'arn'));
  t.is(updatedSnsRule.rule.arn, undefined);

  t.teardown(async () => {
    lambdaStub.restore();
    snsStub.restore();
    await awsServices.sns().deleteTopic({ TopicArn });
  });
});

test.serial('Enabling a disabled SNS rule and passing rule.arn throws specific error', async (t) => {
  const snsTopicArn = randomString();
  const snsStub = sinon.stub(awsServices, 'sns')
    .returns({
      listSubscriptionsByTopic: () => (
        Promise.resolve({
          Subscriptions: [{
            Endpoint: process.env.messageConsumer,
            SubscriptionArn: randomString(),
          }],
        })
      ),
      unsubscribe: () => (
        Promise.resolve()
      ),
    });

  const rule = fakeRuleFactoryV2({
    rule: {
      type: 'sns',
      value: snsTopicArn,
    },
    workflow,
    state: 'DISABLED',
  });

  t.is(rule.rule.value, snsTopicArn);
  t.falsy(rule.rule.arn);
  t.is(rule.state, 'DISABLED');

  const updates = {
    name: rule.name,
    state: 'ENABLED',
    rule: {
      ...rule.rule,
      arn: 'test-value',
    },
  };

  // Should fail because a disabled rule should not have an ARN
  // when being updated
  await t.throwsAsync(updateRuleTrigger(rule, updates, t.context.testKnex),
    undefined,
    'Including rule.arn is not allowed when enabling a disabled rule');
  t.teardown(() => {
    snsStub.restore();
  });
});
