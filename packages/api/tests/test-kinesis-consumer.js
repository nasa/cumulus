'use strict';

const test = require('ava');
const sinon = require('sinon');
const get = require('lodash.get');
const { createQueue, sqs, s3, recursivelyDeleteS3Bucket } = require('@cumulus/common/aws');
const { randomString } = require('@cumulus/common/test-utils');

const { getKinesisRules, handler } = require('../lambdas/kinesis-consumer');
const manager = require('../models/base');
const Rule = require('../models/rules');
const testCollectionName = 'test-collection';

const ruleTableParams = {
  name: 'name',
  type: 'S',
  schema: 'HASH'
};

const eventData = JSON.stringify({
  collection: testCollectionName
});

const event = {
  Records: [
    { kinesis: { data: new Buffer(eventData).toString('base64') } },
    { kinesis: { data: new Buffer(eventData).toString('base64') } }
  ]
};

const commonRuleParams = {
  collection: {
    name: testCollectionName,
    version: '0.0.0'
  },
  provider: 'PROV1',
  rule: {
    type: 'kinesis',
    value: 'test-kinesisarn'
  },
  state: 'ENABLED'
};

const rule1Params = Object.assign({}, commonRuleParams, {
  name: 'testRule1',
  workflow: 'test-workflow-1'
});

const rule2Params = Object.assign({}, commonRuleParams, {
  name: 'testRule2',
  workflow: 'test-workflow-2'
});

const disabledRuleParams = Object.assign({}, commonRuleParams, {
  name: 'disabledRule',
  workflow: 'test-workflow-1',
  state: 'DISABLED'
});

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

test.beforeEach(async (t) => {
  t.context.templateBucket = randomString();
  await s3().createBucket({ Bucket: t.context.templateBucket }).promise();

  t.context.stateMachineArn = randomString();

  t.context.queueUrl = await createQueue();

  t.context.messageTemplate = {
    cumulus_meta: {
      state_machine: t.context.stateMachineArn
    },
    meta: { queues: { startSF: t.context.queueUrl } }
  };
  const messageTemplateKey = `${randomString()}/template.json`;
  await s3().putObject({
    Bucket: t.context.templateBucket,
    Key: messageTemplateKey,
    Body: JSON.stringify(t.context.messageTemplate)
  }).promise();

  sinon.stub(Rule, 'buildPayload').callsFake((item) =>
    Promise.resolve({
      template: `s3://${t.context.templateBucket}/${messageTemplateKey}`,
      provider: item.provider,
      collection: item.collection,
      meta: get(item, 'meta', {}),
      payload: get(item, 'payload', {})
    })
  );

  t.context.tableName = randomString();
  process.env.RulesTable = t.context.tableName;
  process.env.stackName = randomString();
  process.env.bucket = randomString();
  process.env.kinesisConsumer = randomString();

  const model = new Rule(t.context.tableName);
  await manager.createTable(t.context.tableName, ruleTableParams);
  await Promise.all([rule1Params, rule2Params, disabledRuleParams]
    .map((rule) => model.create(rule)));
});

test.afterEach(async (t) => {
  await Promise.all([
    recursivelyDeleteS3Bucket(t.context.templateBucket),
    sqs().deleteQueue({ QueueUrl: t.context.queueUrl }).promise(),
    manager.deleteTable(t.context.tableName)
  ]);
  Rule.buildPayload.restore();
});

// getKinesisRule tests
// eslint-disable-next-line max-len
test('it should look up kinesis-type rules which are associated with the collection, but not those that are disabled', (t) => {
  return getKinesisRules(JSON.parse(eventData))
    .then((result) => {
      t.is(result.length, 2);
    });
});

// handler tests
test('it should enqueue a message for each associated workflow', async (t) => {
  await handler(event, {}, testCallback);
  await sqs().receiveMessage({
    QueueUrl: t.context.queueUrl,
    MaxNumberOfMessages: 10,
    WaitTimeSeconds: 1
  }).promise()
  .then((receiveMessageResponse) => {
    t.is(receiveMessageResponse.Messages.length, 4);
    receiveMessageResponse.Messages.map((message) => (
      t.is(JSON.stringify(JSON.parse(message.Body).payload), JSON.stringify({ collection: 'test-collection' }))
    ));
  });
});

test('it should throw an error if message does not include a collection', (t) => {
  const invalidMessage = JSON.stringify({});
  const kinesisEvent = {
    Records: [{ kinesis: { data: new Buffer(invalidMessage).toString('base64') } }]
  };
  return handler(kinesisEvent, {}, testCallback)
    .catch((err) => {
      const errObject = JSON.parse(err);
      t.is(errObject.errors[0].dataPath, '');
      t.is(errObject.errors[0].message, 'should have required property \'collection\'');
    });
});

test('it should throw an error if message collection has wrong data type', (t) => {
  const invalidMessage = JSON.stringify({ collection: {} });
  const kinesisEvent = {
    Records: [{ kinesis: { data: new Buffer(invalidMessage).toString('base64') } }]
  };
  return handler(kinesisEvent, {}, testCallback)
    .catch((err) => {
      const errObject = JSON.parse(err);
      t.is(errObject.errors[0].dataPath, '.collection');
      t.is(errObject.errors[0].message, 'should be string');
    });
});

test('it should not throw if message is valid', (t) => {
  const validMessage = JSON.stringify({ collection: 'confection-collection' });
  const kinesisEvent = {
    Records: [{ kinesis: { data: new Buffer(validMessage).toString('base64') } }]
  };
  return handler(kinesisEvent, {}, testCallback).then((r) => t.deepEqual(r, [[]]));
});
