'use strict';

const test = require('ava');
const sinon = require('sinon');
const proxyquire = require('proxyquire');
const { mockClient } = require('aws-sdk-client-mock');
const { PublishCommand } = require('@aws-sdk/client-sns');

const { randomString } = require('@cumulus/common/test-utils');
const { sns } = require('@cumulus/aws-client/services');

test.beforeEach((t) => {
  process.env.stackName = randomString();
  process.env.FallbackTopicArn = randomString();

  // Create a fresh sandbox and stubs for each test
  const sandbox = sinon.createSandbox();
  const fetchEnabledRulesStub = sandbox.stub();
  const queueMessageStub = sandbox.stub().resolves(true);

  const snsMock = mockClient(sns());
  snsMock.onAnyCommand().rejects();
  snsMock.on(PublishCommand).resolves();

  // Re-proxy with fresh stubs
  const messageConsumer = proxyquire('../../lambdas/message-consumer', {
    '@cumulus/aws-client/services': { sns: () => snsMock },
    '../lib/rulesHelpers': {
      fetchEnabledRules: fetchEnabledRulesStub,
      queueMessageForRule: queueMessageStub,
    },
  });

  t.context = {
    sandbox,
    fetchEnabledRulesStub,
    queueMessageStub,
    snsMock,
    messageConsumer,
  };
});

test.afterEach.always((t) => {
  t.context.sandbox.restore();
  t.context.snsMock.reset();
  delete process.env.allow_provider_mismatch_on_rule_filter;
});

test.serial('handler correctly processes mixed record types and handles errors via fallback', async (t) => {
  const { fetchEnabledRulesStub, queueMessageStub, snsMock, messageConsumer } = t.context;

  const collection = {
    name: 'ABC',
    version: '1.2.3',
  };
  const topicArn = randomString();

  const sqsRule = {
    collection,
    rule: { type: 'sns', value: topicArn },
    state: 'ENABLED',
  };
  const kinesisRule = {
    collection,
    rule: { type: 'kinesis', value: randomString() },
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

  // Update snsMock to accept the fallback error message
  snsMock.reset();
  snsMock.on(PublishCommand).callsFake((params) => {
    t.is(params.TopicArn, process.env.FallbackTopicArn);
    t.deepEqual(params.Message, JSON.stringify(erroringMessage));
    return Promise.resolve();
  });

  const results = await messageConsumer.handler(
    { Records: [snsMessage, kinesisMessage, kinesisFallbackMessage, erroringMessage] }
  );

  t.deepEqual(results, [[true], [true], [true]]);
  t.true(fetchEnabledRulesStub.calledOnce);

  const expectedArgs = {
    TopicArn: process.env.FallbackTopicArn,
    Message: JSON.stringify(erroringMessage),
  };

  const publishCalls = snsMock.commandCalls(PublishCommand);
  t.true(publishCalls.length > 0);
  t.deepEqual(expectedArgs, publishCalls[0].firstArg.input);

  t.is(queueMessageStub.callCount, 3);
});

test.serial('handler processes records only when record and rule have matching provider', async (t) => {
  const { fetchEnabledRulesStub, queueMessageStub, messageConsumer } = t.context;

  const collection = {
    name: 'ABC',
    version: '1.2.3',
  };
  const provider = randomString();

  const ruleWithProvider = {
    collection,
    provider,
    rule: {
      type: 'kinesis',
      value: randomString(),
    },
    state: 'ENABLED',
  };

  fetchEnabledRulesStub.returns(Promise.resolve([ruleWithProvider]));

  const messageWithProvider = {
    EventSource: 'aws:kinesis',
    kinesis: {
      data: Buffer.from(JSON.stringify({
        collection: collection.name,
        provider,
        product: {
          dataVersion: collection.version,
        },
      })).toString('base64'),
    },
  };

  const messageWoProvider = {
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

  const messageWithWrongProvider = {
    EventSource: 'aws:kinesis',
    kinesis: {
      data: Buffer.from(JSON.stringify({
        collection: collection.name,
        provider: randomString(), // doesn't match rule
        product: {
          dataVersion: collection.version,
        },
      })).toString('base64'),
    },
  };

  const results = await messageConsumer.handler(
    { Records: [messageWithProvider, messageWoProvider, messageWithWrongProvider] }
  );

  t.deepEqual(results, [[true], [true], []]);
  t.true(fetchEnabledRulesStub.calledOnce);
  t.is(queueMessageStub.callCount, 2);
});

test.serial('handler processes records with mismatched rule/message providers when lambda var allow_provider_mismatch_on_rule_filter is set to true', async (t) => {
  const { fetchEnabledRulesStub, queueMessageStub, messageConsumer } = t.context;
  process.env.allow_provider_mismatch_on_rule_filter = true;
  const collection = {
    name: 'ABC',
    version: '1.2.3',
  };
  const provider = randomString();

  const ruleWithProvider = {
    collection,
    provider,
    rule: {
      type: 'kinesis',
      value: randomString(),
    },
    state: 'ENABLED',
  };

  fetchEnabledRulesStub.returns(Promise.resolve([ruleWithProvider]));

  const messageWithProvider = {
    EventSource: 'aws:kinesis',
    kinesis: {
      data: Buffer.from(JSON.stringify({
        collection: collection.name,
        provider,
        product: {
          dataVersion: collection.version,
        },
      })).toString('base64'),
    },
  };

  const messageWoProvider = {
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

  const messageWithWrongProvider1 = {
    EventSource: 'aws:kinesis',
    kinesis: {
      data: Buffer.from(JSON.stringify({
        collection: collection.name,
        provider: randomString(),
        product: {
          dataVersion: collection.version,
        },
      })).toString('base64'),
    },
  };

  const messageWithWrongProvider2 = {
    EventSource: 'aws:kinesis',
    kinesis: {
      data: Buffer.from(JSON.stringify({
        collection: collection.name,
        provider: randomString(), // doesn't match rule
        product: {
          dataVersion: collection.version,
        },
      })).toString('base64'),
    },
  };

  const results = await messageConsumer.handler(
    { Records: [messageWithProvider, messageWoProvider,
      messageWithWrongProvider1, messageWithWrongProvider2] }
  );

  t.deepEqual(results, [[true], [true], [true], [true]]);
  t.true(fetchEnabledRulesStub.calledOnce);
  t.is(queueMessageStub.callCount, 4);
});
