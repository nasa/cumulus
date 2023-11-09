'use strict';

const test = require('ava');
const sinon = require('sinon');
const proxyquire = require('proxyquire');

const { randomString } = require('@cumulus/common/test-utils');

const sandbox = sinon.createSandbox();
const stubPromiseReturn = { promise: () => Promise.resolve() };
const fetchEnabledRulesStub = sandbox.stub();
const publishMessageStub = sandbox.stub().returns(stubPromiseReturn);
const queueMessageStub = sandbox.stub().resolves(true);

const messageConsumer = proxyquire('../../lambdas/message-consumer', {
  '@cumulus/aws-client/services': { sns: () => ({ publish: publishMessageStub }) },
  '../lib/rulesHelpers': {
    fetchEnabledRules: fetchEnabledRulesStub,
    queueMessageForRule: queueMessageStub,
  },
});

test.before(() => {
  process.env.stackName = randomString();
  process.env.FallbackTopicArn = randomString();
});

test.afterEach.always(() => {
  fetchEnabledRulesStub.reset();
  publishMessageStub.reset();
  queueMessageStub.reset();
});

test.skip('handler processes records as expected', async (t) => {
  const collection = {
    name: 'ABC',
    version: '1.2.3',
  };
  const topicArn = randomString();
  const sqsRule = {
    collection,
    rule: {
      type: 'sns',
      value: topicArn,
    },
    state: 'ENABLED',
  };
  const kinesisRule = {
    collection,
    rule: {
      type: 'kinesis',
      value: randomString(),
    },
    state: 'ENABLED',
  };
  fetchEnabledRulesStub.returns(Promise.resolve([sqsRule, kinesisRule]));
  const snsMessage = {
    EventSource: 'aws:sns',
    Sns: {
      TopicArn: topicArn,
      Message: JSON.stringify({ collection }),
    },
  };
  const kinesisMessage = {
    EventSource: 'aws:kinesis',
    kinesis: {
      data: Buffer.from(JSON.stringify({
        collection: collection.name,
        product: {
          dataVersion: collection.version,
        },
      })).toString('base64'),
    },
  };
  const kinesisFallbackMessage = {
    EventSource: 'aws:sns',
    Sns: {
      TopicArn: topicArn,
      Message: JSON.stringify({
        kinesis: {
          data: Buffer.from(JSON.stringify({
            collection: collection.name,
            product: {
              dataVersion: collection.version,
            },
          })).toString('base64'),
        },
      }),
    },
  };
  const erroringMessage = {
    EventSource: 'aws:kinesis',
    kinesis: {
      data: 'notabase64string',
    },
  };

  publishMessageStub.callsFake((params) => {
    t.is(params.TopicArn, process.env.FallbackTopicArn);
    t.deepEqual(params.Message, JSON.stringify(erroringMessage));
    return stubPromiseReturn;
  });

  await messageConsumer.handler(
    { Records: [snsMessage, kinesisMessage, kinesisFallbackMessage, erroringMessage] },
    {},
    (_, data) => {
      t.deepEqual(data, [[true], [true], [true]]);
    }
  );
  t.true(fetchEnabledRulesStub.calledOnce);

  t.true(publishMessageStub.withArgs({
    TopicArn: process.env.FallbackTopicArn,
    Message: JSON.stringify(erroringMessage),
  }).calledOnce);

  t.is(queueMessageStub.callCount, 3);
});
