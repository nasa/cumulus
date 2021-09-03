'use strict';

const sinon = require('sinon');
const test = require('ava');
const proxyquire = require('proxyquire');

const { randomString } = require('@cumulus/common/test-utils');
const testCollectionName = 'test-collection';

const sandbox = sinon.createSandbox();
const fetchEnabledRulesStub = sandbox.stub();
const queueMessageStub = sandbox.stub().resolves(true);
const { handler } = proxyquire('../../lambdas/message-consumer', {
  '../lib/rulesHelpers': {
    fetchEnabledRules: fetchEnabledRulesStub,
    queueMessageForRule: queueMessageStub,
  },
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

const snsArn = 'test-SnsArn';
const messageBody = '{"Data":{}}';

const event = {
  Records: [
    {
      EventSource: 'aws:sns',
      EventVersion: '1.0',
      EventSubscriptionArn: 'arn:aws:sns:us-east-1:00000000000:gdelt-csv:111111-111',
      Sns: {
        Type: 'Notification',
        MessageId: '4f411981',
        TopicArn: snsArn,
        Subject: 'Amazon S3 Notification',
        Message: messageBody,
        MessageAttributes: {},
      },
    },
  ],
};

const collection = {
  name: testCollectionName,
  version: '0.0.0',
};
const provider = { id: 'PROV1' };

test.before(() => {
  process.env.stackName = randomString();
  process.env.system_bucket = randomString();
  process.env.messageConsumer = randomString();
});

test.afterEach.always(() => {
  queueMessageStub.resetHistory();
});

test.after.always(() => {
  sandbox.restore();
});

// handler tests
test.serial('it should enqueue a message for each SNS rule', async (t) => {
  const rule1 = {
    name: 'testRule1',
    collection,
    provider: provider.id,
    rule: {
      type: 'sns',
      value: snsArn,
    },
    state: 'ENABLED',
    workflow: 'test-workflow-1',
  };

  const expectedRule = {
    ...rule1,
    meta: {
      snsSourceArn: snsArn,
    },
  };

  fetchEnabledRulesStub.returns(Promise.resolve([rule1]));
  await handler(event, {}, testCallback);

  t.is(queueMessageStub.callCount, 1);
  t.deepEqual(queueMessageStub.getCall(0).args[0], expectedRule);
  t.deepEqual(queueMessageStub.getCall(0).args[1], JSON.parse(messageBody));
});
