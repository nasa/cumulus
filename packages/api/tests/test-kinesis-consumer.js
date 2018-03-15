'use strict';
const get = require('lodash.get');
const sinon = require('sinon');
const proxyquire =  require('proxyquire').noPreserveCache().noCallThru();
const test = require('ava');

const { s3, recursivelyDeleteS3Bucket } = require('@cumulus/common/aws');
const { randomString } = require('@cumulus/common/test-utils');
const awsIngest = require('@cumulus/ingest/aws');
const { getKinesisRules, handler } = require('../lambdas/kinesis-consumer');

const manager = require('../models/base');
const Rule = require('../models/rules');
const testCollectionName = 'test-collection';

process.env.invoke = 'sfScheduler';
const sfSchedulerSpy = sinon.spy(awsIngest, 'invoke');

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
  t.context.stateMachineArn = randomString();
  const messageTemplateKey = `${randomString()}/template.json`;
  t.context.messageTemplateKey = messageTemplateKey;

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
  const actualPayload = sfSchedulerSpy.getCall(0).args[1];
  const expectedPayload = {
    template: `s3://${t.context.templateBucket}/${t.context.messageTemplateKey}`,
    provider: commonRuleParams.provider,
    collection: commonRuleParams.collection,
    meta: {},
    payload: JSON.parse(eventData)
  };
  t.deepEqual(expectedPayload, actualPayload);
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
