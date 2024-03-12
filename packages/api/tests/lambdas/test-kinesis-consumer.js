'use strict';

const sinon = require('sinon');
const test = require('ava');
const proxyquire = require('proxyquire');
const { mockClient } = require('aws-sdk-client-mock');
const { PublishCommand } = require('@aws-sdk/client-sns');

const { randomString, randomId } = require('@cumulus/common/test-utils');
const { s3, sns } = require('@cumulus/aws-client/services');
const { recursivelyDeleteS3Bucket } = require('@cumulus/aws-client/S3');
const { fakeRuleFactoryV2 } = require('../../lib/testUtils');

const sandbox = sinon.createSandbox();
const queueMessageStub = sandbox.stub().resolves(true);
const fetchEnabledRulesStub = sandbox.stub();
const { handler } = proxyquire('../../lambdas/message-consumer', {
  '../lib/rulesHelpers': {
    fetchEnabledRules: fetchEnabledRulesStub,
    queueMessageForRule: queueMessageStub,
  },
});

const snsClient = sns();

const testCollectionName = 'test-collection';

const eventObject = {
  collection: testCollectionName,
};
const eventData = JSON.stringify(eventObject);

const validRecord = {
  kinesis: {
    data: Buffer.from(eventData).toString('base64'),
  },
};

const event = {
  Records: [validRecord, validRecord],
};

const collection = {
  name: testCollectionName,
  version: '1.0.0',
};
const provider = { id: 'PROV1' };

const kinesisRule = {
  collection,
  provider: provider.id,
  name: 'testRule1',
  workflow: 'test-workflow-1',
  state: 'ENABLED',
  rule: {
    type: 'kinesis',
    value: `arn:aws:kinesis:us-east-1:000000000000:${randomId('kinesis')}`,
  },
};

/**
 * translates a kinesis event object into an object that an SNS event will
 * redeliver to the fallback handler.
 *
 * @param {Object} record - kinesis record object.
 * @returns {Object} - object representing an SNS event.
 */
function wrapKinesisRecordInSnsEvent(record) {
  return {
    Records: [{
      EventSource: 'aws:sns',
      Sns: {
        Message: JSON.stringify(record),
      },
    }],
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

let snsMock;
let templateBucket;

test.before(async () => {
  process.env.messageConsumer = 'my-messageConsumer';
  process.env.KinesisInboundEventLogger = 'my-ruleInput';
  templateBucket = randomString();
  const messageTemplateKey = `${randomString()}/template.json`;
  const messageTemplate = {};

  await s3().createBucket({ Bucket: templateBucket });
  await s3().putObject({
    Bucket: templateBucket,
    Key: messageTemplateKey,
    Body: JSON.stringify(messageTemplate),
  });
});

test.beforeEach((t) => {
  t.context.publishResponse = {
    ResponseMetadata: { RequestId: randomString() },
    MessageId: randomString(),
  };
  snsMock = mockClient(snsClient);
  snsMock
    .onAnyCommand()
    .rejects()
    .on(PublishCommand)
    .resolves(Promise.resolve(t.context.publishResponse));

  process.env.stackName = randomString();
  process.env.system_bucket = randomString();
  process.env.messageConsumer = randomString();

  t.context.createdRule = fakeRuleFactoryV2(kinesisRule);
  fetchEnabledRulesStub.callsFake(() => Promise.resolve([t.context.createdRule]));
});

test.afterEach.always(() => {
  queueMessageStub.resetHistory();
  snsMock.restore();
});

test.after.always(async () => {
  await recursivelyDeleteS3Bucket(templateBucket);
  sandbox.restore();
});

// handler tests
test.serial('it should enqueue a message for each associated rule', async (t) => {
  await handler(event, {}, testCallback);
  t.is(queueMessageStub.callCount, 2);
  queueMessageStub.getCalls().forEach((call) => {
    t.deepEqual(call.args[0], t.context.createdRule);
    t.deepEqual(call.args[1], eventObject);
  });
});

test.serial('A kinesis message, should publish the invalid record to fallbackSNS if message does not include a collection', async (t) => {
  const invalidMessage = JSON.stringify({ noCollection: 'in here' });
  const invalidRecord = { kinesis: { data: Buffer.from(invalidMessage).toString('base64') } };
  const kinesisEvent = {
    Records: [validRecord, invalidRecord],
  };
  await handler(kinesisEvent, {}, testCallback);

  const publishCalls = snsMock.commandCalls(PublishCommand);

  t.true(publishCalls.length > 0);
  t.deepEqual(invalidRecord, JSON.parse(publishCalls[0].firstArg.input.Message));
});

test.serial('An SNS fallback retry, should throw an error if message does not include a collection', async (t) => {
  const invalidMessage = JSON.stringify({});
  const kinesisEvent = {
    Records: [{ kinesis: { data: Buffer.from(invalidMessage).toString('base64') } }],
  };
  const snsEvent = wrapKinesisRecordInSnsEvent(kinesisEvent.Records[0]);

  const error = await t.throwsAsync(
    () => handler(snsEvent, {}, testCallback),
    { message: 'validation failed' }
  );

  t.is(error.errors[0].message, 'should have required property \'collection\'');
});

test.serial('A kinesis message, should publish the invalid records to fallbackSNS if the message collection has wrong data type', async (t) => {
  const invalidMessage = JSON.stringify({ collection: {} });
  const invalidRecord = { kinesis: { data: Buffer.from(invalidMessage).toString('base64') } };
  const kinesisEvent = { Records: [invalidRecord] };

  await handler(kinesisEvent, {}, testCallback);

  const publishCalls = snsMock.commandCalls(PublishCommand);

  t.true(publishCalls.length > 0);
  t.deepEqual(invalidRecord, JSON.parse(publishCalls[0].firstArg.input.Message));
});

test.serial('An SNS Fallback retry, should throw an error if message collection has wrong data type', async (t) => {
  const invalidMessage = JSON.stringify({ collection: {} });
  const kinesisEvent = {
    Records: [{ kinesis: { data: Buffer.from(invalidMessage).toString('base64') } }],
  };
  const snsEvent = wrapKinesisRecordInSnsEvent(kinesisEvent.Records[0]);

  const error = await t.throwsAsync(
    () => handler(snsEvent, {}, testCallback),
    { message: 'validation failed' }
  );

  t.is(error.errors[0].dataPath, '.collection');
  t.is(error.errors[0].message, 'should be string');
});

test.serial('A kinesis message, should publish the invalid record to fallbackSNS if message is invalid json', async (t) => {
  const invalidMessage = '{';
  const invalidRecord = { kinesis: { data: Buffer.from(invalidMessage).toString('base64') } };
  const kinesisEvent = { Records: [invalidRecord] };

  await handler(kinesisEvent, {}, testCallback);

  const publishCalls = snsMock.commandCalls(PublishCommand);

  t.true(publishCalls.length > 0);
  t.deepEqual(invalidRecord, JSON.parse(publishCalls[0].firstArg.input.Message));
});

test.serial('An SNS Fallback retry, should throw an error if message is invalid json', async (t) => {
  const invalidMessage = '{';
  const kinesisEvent = {
    Records: [{ kinesis: { data: Buffer.from(invalidMessage).toString('base64') } }],
  };
  const snsEvent = wrapKinesisRecordInSnsEvent(kinesisEvent.Records[0]);

  await t.throwsAsync(
    handler(snsEvent, {}, testCallback),
    { message: 'Unexpected end of JSON input' }
  );
});

test.serial('A kinesis message should not publish record to fallbackSNS if it processes.', (t) => {
  const validMessage = JSON.stringify({ collection: testCollectionName });
  const kinesisEvent = {
    Records: [{ kinesis: { data: Buffer.from(validMessage).toString('base64') } }],
  };
  const publishCalls = snsMock.commandCalls(PublishCommand);

  t.true(publishCalls.length < 1);
  return handler(kinesisEvent, {}, testCallback)
    .then((r) => t.deepEqual(r, [[true]]));
});

test.serial('An SNS Fallback message should not throw if message is valid.', (t) => {
  const validMessage = JSON.stringify({ collection: testCollectionName });
  const kinesisEvent = {
    Records: [{ kinesis: { data: Buffer.from(validMessage).toString('base64') } }],
  };
  const snsEvent = wrapKinesisRecordInSnsEvent(kinesisEvent.Records[0]);
  return handler(snsEvent, {}, testCallback)
    .then((r) => t.deepEqual(r, [[true]]));
});

test.serial('An error publishing falllback record for Kinesis message should re-throw error from validation', async (t) => {
  snsMock.restore();
  snsMock = mockClient(snsClient);
  snsMock
    .onAnyCommand()
    .rejects()
    .on(PublishCommand)
    .rejects(new Error('fail'));

  const invalidMessage = JSON.stringify({ noCollection: 'in here' });
  const invalidRecord = { kinesis: { data: Buffer.from(invalidMessage).toString('base64') } };
  const kinesisEvent = {
    Records: [validRecord, invalidRecord],
  };

  try {
    await t.throwsAsync(
      handler(kinesisEvent, {}, testCallback),
      { message: /validation/ }
    );
  } finally {
    snsMock.restore();
  }
});
