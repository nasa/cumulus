'use strict';

const get = require('lodash.get');
const sinon = require('sinon');
const test = require('ava');

const { randomString } = require('@cumulus/common/test-utils');
const {
    s3,
    sendSQSMessage,
    recursivelyDeleteS3Bucket
} = require('@cumulus/common/aws');
const { getKinesisRules, handler } = require('../../lambdas/kinesis-consumer');

const Collection = require('../../models/collections');
const Rule = require('../../models/rules');
const Provider = require('../../models/providers');
const testCollectionName = 'test-collection';

const eventData = JSON.stringify({
  collection: testCollectionName
});

const event = {
  Records: [
    { kinesis: { data: Buffer.from(eventData).toString('base64') } },
    { kinesis: { data: Buffer.from(eventData).toString('base64') } }
  ]
};

const collection = {
  name: testCollectionName,
  version: '0.0.0'
};
const provider = { id: 'PROV1' };

const commonRuleParams = {
  collection,
  provider: provider.id,
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

let sfSchedulerSpy;
const stubQueueUrl = 'stubQueueUrl';

let ruleModel;
test.before(async () => {
  process.env.CollectionsTable = randomString();
  process.env.ProvidersTable = randomString();
  process.env.RulesTable = randomString();
  ruleModel = new Rule();
  await ruleModel.createTable();
});

test.beforeEach(async (t) => {
  sfSchedulerSpy = sinon.stub(aws, 'sendSQSMessage').returns(true);
  t.context.templateBucket = randomString();
  t.context.stateMachineArn = randomString();
  const messageTemplateKey = `${randomString()}/template.json`;

  t.context.messageTemplateKey = messageTemplateKey;
  t.context.messageTemplate = {
    cumulus_meta: {
      state_machine: t.context.stateMachineArn
    },
    meta: { queues: { startSF: stubQueueUrl } }
  };

  await s3().createBucket({ Bucket: t.context.templateBucket }).promise();
  await s3().putObject({
    Bucket: t.context.templateBucket,
    Key: messageTemplateKey,
    Body: JSON.stringify(t.context.messageTemplate)
  }).promise();

  sinon.stub(Rule, 'buildPayload').callsFake((item) => Promise.resolve({
    template: `s3://${t.context.templateBucket}/${messageTemplateKey}`,
    provider: item.provider,
    collection: item.collection,
    meta: get(item, 'meta', {}),
    payload: get(item, 'payload', {})
  }));
  sinon.stub(Provider.prototype, 'get').returns(provider);
  sinon.stub(Collection.prototype, 'get').returns(collection);

  t.context.tableName = process.env.RulesTable;
  process.env.stackName = randomString();
  process.env.bucket = randomString();
  process.env.kinesisConsumer = randomString();

  await Promise.all([rule1Params, rule2Params, disabledRuleParams]
    .map((rule) => ruleModel.create(rule)));
});

test.afterEach(async (t) => {
  await recursivelyDeleteS3Bucket(t.context.templateBucket);
  sfSchedulerSpy.restore();
  Rule.buildPayload.restore();
  Provider.prototype.get.restore();
  Collection.prototype.get.restore();
});

test.after.always(async () => {
  await ruleModel.deleteTable();
});

// getKinesisRule tests
// eslint-disable-next-line max-len
test.serial('it should look up kinesis-type rules which are associated with the collection, but not those that are disabled', async (t) => {
  await getKinesisRules(JSON.parse(eventData))
    .then((result) => {
      t.is(result.length, 2);
    });
});

// handler tests
test.serial('it should enqueue a message for each associated workflow', async (t) => {
  await handler(event, {}, testCallback);
  const actualQueueUrl = sfSchedulerSpy.getCall(0).args[0];
  t.is(actualQueueUrl, stubQueueUrl);
  const actualMessage = sfSchedulerSpy.getCall(0).args[1];
  const expectedMessage = {
    cumulus_meta: {
      state_machine: t.context.stateMachineArn
    },
    meta: {
      queues: { startSF: stubQueueUrl },
      provider,
      collection
    },
    payload: {
      collection: 'test-collection'
    }
  };
  t.is(actualMessage.cumulus_meta.state_machine, expectedMessage.cumulus_meta.state_machine);
  t.deepEqual(actualMessage.meta, expectedMessage.meta);
  t.deepEqual(actualMessage.payload, expectedMessage.payload);
});

test.serial('it should throw an error if message does not include a collection', async (t) => {
  const invalidMessage = JSON.stringify({});
  const kinesisEvent = {
    Records: [{ kinesis: { data: Buffer.from(invalidMessage).toString('base64') } }]
  };
  const errors = await handler(kinesisEvent, {}, testCallback);
  t.is(errors[0].message, 'validation failed');
  t.is(errors[0].errors[0].dataPath, '');
  t.is(errors[0].errors[0].message, 'should have required property \'collection\'');
});

test.serial('it should throw an error if message collection has wrong data type', async (t) => {
  const invalidMessage = JSON.stringify({ collection: {} });
  const kinesisEvent = {
    Records: [{ kinesis: { data: Buffer.from(invalidMessage).toString('base64') } }]
  };
  const errors = await handler(kinesisEvent, {}, testCallback);
  t.is(errors[0].message, 'validation failed');
  t.is(errors[0].errors[0].dataPath, '.collection');
  t.is(errors[0].errors[0].message, 'should be string');
});

test.serial('it should throw an error if message is invalid json', async (t) => {
  const invalidMessage = '{';
  const kinesisEvent = {
    Records: [{ kinesis: { data: Buffer.from(invalidMessage).toString('base64') } }]
  };
  const errors = await handler(kinesisEvent, {}, testCallback);
  t.is(errors[0].message, 'Unexpected end of JSON input');
});

test.serial('it should not throw if message is valid', (t) => {
  const validMessage = JSON.stringify({ collection: 'confection-collection' });
  const kinesisEvent = {
    Records: [{ kinesis: { data: Buffer.from(validMessage).toString('base64') } }]
  };
  return handler(kinesisEvent, {}, testCallback).then((r) => t.deepEqual(r, [[]]));
});
