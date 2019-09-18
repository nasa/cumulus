'use strict';

const sinon = require('sinon');
const test = require('ava');

const { randomString } = require('@cumulus/common/test-utils');
const { SQS } = require('@cumulus/ingest/aws');
const { s3, recursivelyDeleteS3Bucket, sns } = require('@cumulus/common/aws');
const { getRules, handler } = require('../../lambdas/message-consumer');
const Collection = require('../../models/collections');
const Rule = require('../../models/rules');
const Provider = require('../../models/providers');
const testCollectionName = 'test-collection';
const snsClient = sns();

const eventData = JSON.stringify({
  collection: testCollectionName
});

const validRecord = {
  kinesis: {
    data: Buffer.from(eventData).toString('base64')
  }
};

const event = {
  Records: [validRecord, validRecord]
};

const collection = {
  name: testCollectionName,
  version: '0.0.0'
};
const provider = { id: 'PROV1' };

const workflows = [
  'test-workflow-1',
  'test-workflow-2'
];

const commonRuleParams = {
  collection,
  provider: provider.id
};

const kinesisRuleParams = {
  rule: {
    type: 'kinesis',
    value: 'test-kinesisarn'
  }
};

const rule1Params = {
  name: 'testRule1',
  workflow: workflows[0],
  state: 'ENABLED'
};

// if the state is not provided, it will be set to default value 'ENABLED'
const rule2Params = Object.assign({}, commonRuleParams, {
  name: 'testRule2',
  workflow: workflows[1]
});

const disabledRuleParams = {
  name: 'disabledRule',
  workflow: workflows[0],
  state: 'DISABLED'
};

const allRuleTypesParams = [kinesisRuleParams];
const allOtherRulesParams = [rule1Params, rule2Params, disabledRuleParams];
const rulesToCreate = [];

let sfSchedulerSpy;
let publishStub;
const stubQueueUrl = 'stubQueueUrl';

allRuleTypesParams.forEach((ruleTypeParams) => {
  allOtherRulesParams.forEach((otherRulesParams) => {
    const ruleParams = Object.assign({}, commonRuleParams, ruleTypeParams, otherRulesParams);
    rulesToCreate.push(ruleParams);
  });
});

/**
 * translates a kinesis event object into an object that an SNS event will
 * redeliver to the fallback handler.
 *
 * @param {Object} record - kinesis record object.
 * @returns {Object} - object representing an SNS event.
 */
function wrapKinesisRecord(record) {
  return {
    Records: [{
      EventSource: 'aws:sns',
      Sns: {
        Message: JSON.stringify(record)
      }
    }]
  };
}

/**
 * Callback used for testing
 *
 * @param {*} err - error
 * @param {Object} object - object
 * @returns {Object} object, if no error is thrown
 */
function testCallback(err, object) {
  if (err) throw err;
  return object;
}

let ruleModel;
test.before(async () => {
  process.env.CollectionsTable = randomString();
  process.env.ProvidersTable = randomString();
  process.env.RulesTable = randomString();
  process.env.messageConsumer = 'my-messageConsumer';
  process.env.KinesisInboundEventLogger = 'my-ruleInput';
  ruleModel = new Rule();
  await ruleModel.createTable();
});

test.beforeEach(async (t) => {
  process.env.stackName = randomString();
  process.env.system_bucket = randomString();
  process.env.messageConsumer = randomString();

  sfSchedulerSpy = sinon.stub(SQS, 'sendMessage').returns(true);
  t.context.publishResponse = {
    ResponseMetadata: { RequestId: randomString() },
    MessageId: randomString()
  };
  publishStub = sinon.stub(snsClient, 'publish').returns({ promise: () => Promise.resolve(t.context.publishResponse) });

  t.context.templateBucket = process.env.system_bucket;
  const messageTemplateKey = `${process.env.stackName}/workflows/template.json`;
  const workflowListKey = `${process.env.stackName}/workflows/list.json`;

  t.context.messageTemplateKey = messageTemplateKey;
  t.context.messageTemplate = {
    meta: { queues: { startSF: stubQueueUrl } }
  };
  t.context.workflowList = workflows.map((workflow) => ({
    name: workflow,
    arn: `arn:${workflow}`,
    template: `s3://${t.context.templateBucket}/${messageTemplateKey}`,
    definition: {}
  }));

  await s3().createBucket({ Bucket: t.context.templateBucket }).promise();
  await Promise.all([
    s3().putObject({
      Bucket: t.context.templateBucket,
      Key: messageTemplateKey,
      Body: JSON.stringify(t.context.messageTemplate)
    }).promise(),
    s3().putObject({
      Bucket: t.context.templateBucket,
      Key: workflowListKey,
      Body: JSON.stringify(t.context.workflowList)
    }).promise()
  ]);

  sinon.stub(Provider.prototype, 'get').returns(provider);
  sinon.stub(Collection.prototype, 'get').returns(collection);

  t.context.tableName = process.env.RulesTable;
  await Promise.all(rulesToCreate.map((rule) => ruleModel.create(rule)));
});

test.afterEach.always(async (t) => {
  await recursivelyDeleteS3Bucket(t.context.templateBucket);
  sfSchedulerSpy.restore();
  publishStub.restore();
  Provider.prototype.get.restore();
  Collection.prototype.get.restore();
});

test.after.always(async () => {
  await ruleModel.deleteTable();
});

// getKinesisRule tests
test.serial('it should look up kinesis-type rules which are associated with the collection, but not those that are disabled', async (t) => {
  await getRules(testCollectionName, 'kinesis')
    .then((result) => {
      t.is(result.length, 2);
    });
});

// handler tests
test.serial('it should enqueue a message for each associated workflow', async (t) => {
  await handler(event, {}, testCallback);
  t.is(sfSchedulerSpy.callCount, 4); // 2 records * 2 rules
  const actualQueueUrl = sfSchedulerSpy.getCall(0).args[0];
  t.is(actualQueueUrl, stubQueueUrl);
  const actualMessage = sfSchedulerSpy.getCall(0).args[1];
  const expectedMeta = {
    queues: { startSF: stubQueueUrl },
    provider,
    collection,
    workflow_name: actualMessage.meta.workflow_name // testing separately
  };
  const expectedPayload = {
    collection: testCollectionName
  };
  // due to race condition, which workflow comes out in call[0] may vary.
  const stateMachines = workflows.map((wf) => `arn:${wf}`);
  t.true(stateMachines.includes(actualMessage.cumulus_meta.state_machine));
  t.true(workflows.includes(actualMessage.meta.workflow_name));
  t.deepEqual(actualMessage.meta, expectedMeta);
  t.deepEqual(actualMessage.payload, expectedPayload);
});

test.serial('A kinesis message, should publish the invalid record to fallbackSNS if message does not include a collection', async (t) => {
  const invalidMessage = JSON.stringify({ noCollection: 'in here' });
  const invalidRecord = { kinesis: { data: Buffer.from(invalidMessage).toString('base64') } };
  const kinesisEvent = {
    Records: [validRecord, invalidRecord]
  };
  await handler(kinesisEvent, {}, testCallback);
  const callArgs = publishStub.getCall(0).args;
  t.deepEqual(invalidRecord, JSON.parse(callArgs[0].Message));
  t.true(publishStub.calledOnce);
});

test.serial('An SNS fallback retry, should throw an error if message does not include a collection', async (t) => {
  const invalidMessage = JSON.stringify({});
  const kinesisEvent = {
    Records: [{ kinesis: { data: Buffer.from(invalidMessage).toString('base64') } }]
  };
  const snsEvent = wrapKinesisRecord(kinesisEvent.Records[0]);

  const error = await t.throwsAsync(
    () => handler(snsEvent, {}, testCallback),
    'validation failed'
  );

  t.is(error.errors[0].message, 'should have required property \'collection\'');
});

test.serial('A kinesis message, should publish the invalid records to fallbackSNS if the message collection has wrong data type', async (t) => {
  const invalidMessage = JSON.stringify({ collection: {} });
  const invalidRecord = { kinesis: { data: Buffer.from(invalidMessage).toString('base64') } };
  const kinesisEvent = { Records: [invalidRecord] };

  await handler(kinesisEvent, {}, testCallback);

  const callArgs = publishStub.getCall(0).args;
  t.deepEqual(invalidRecord, JSON.parse(callArgs[0].Message));
  t.true(publishStub.calledOnce);
});

test.serial('An SNS Fallback retry, should throw an error if message collection has wrong data type', async (t) => {
  const invalidMessage = JSON.stringify({ collection: {} });
  const kinesisEvent = {
    Records: [{ kinesis: { data: Buffer.from(invalidMessage).toString('base64') } }]
  };
  const snsEvent = wrapKinesisRecord(kinesisEvent.Records[0]);

  const error = await t.throwsAsync(
    () => handler(snsEvent, {}, testCallback),
    'validation failed'
  );

  t.is(error.errors[0].dataPath, '.collection');
  t.is(error.errors[0].message, 'should be string');
});

test.serial('A kinesis message, should publish the invalid record to fallbackSNS if message is invalid json', async (t) => {
  const invalidMessage = '{';
  const invalidRecord = { kinesis: { data: Buffer.from(invalidMessage).toString('base64') } };
  const kinesisEvent = { Records: [invalidRecord] };

  await handler(kinesisEvent, {}, testCallback);

  const callArgs = publishStub.getCall(0).args;
  t.deepEqual(invalidRecord, JSON.parse(callArgs[0].Message));
  t.true(publishStub.calledOnce);
});

test.serial('An SNS Fallback retry, should throw an error if message is invalid json', async (t) => {
  const invalidMessage = '{';
  const kinesisEvent = {
    Records: [{ kinesis: { data: Buffer.from(invalidMessage).toString('base64') } }]
  };
  const snsEvent = wrapKinesisRecord(kinesisEvent.Records[0]);

  await t.throws(
    () => handler(snsEvent, {}, testCallback),
    'Unexpected end of JSON input'
  );
});

test.serial('A kinesis message should not publish record to fallbackSNS if it processes.', (t) => {
  const validMessage = JSON.stringify({ collection: 'confection-collection' });
  const kinesisEvent = {
    Records: [{ kinesis: { data: Buffer.from(validMessage).toString('base64') } }]
  };
  t.true(publishStub.notCalled);
  return handler(kinesisEvent, {}, testCallback).then((r) => t.deepEqual(r, [[]]));
});

test.serial('An SNS Fallback message should not throw if message is valid.', (t) => {
  const validMessage = JSON.stringify({ collection: 'confection-collection' });
  const kinesisEvent = {
    Records: [{ kinesis: { data: Buffer.from(validMessage).toString('base64') } }]
  };
  const snsEvent = wrapKinesisRecord(kinesisEvent.Records[0]);
  return handler(snsEvent, {}, testCallback).then((r) => t.deepEqual(r, [[]]));
});
