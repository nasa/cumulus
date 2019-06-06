'use strict';

const test = require('ava');
const rewire = require('rewire');

const message = rewire('../message');
const {
  buildCumulusMeta,
  buildQueueMessageFromTemplate,
  getQueueNameByUrl,
  getMessageFromTemplate
} = message;

const { randomId, randomString } = require('../test-utils');

const executionName = randomString();
message.__set__('createExecutionName', () => executionName);

test('buildCumulusMeta returns expected object', (t) => {
  const queueName = randomId('queue');

  let cumulusMeta = buildCumulusMeta({
    queueName
  });

  t.deepEqual(cumulusMeta, {
    queueName,
    execution_name: executionName
  });

  const parentExecutionArn = randomId('parentArn');
  cumulusMeta = buildCumulusMeta({
    queueName,
    parentExecutionArn
  });

  t.deepEqual(cumulusMeta, {
    queueName,
    parentExecutionArn,
    execution_name: executionName
  });
});

test('getQueueNameByUrl returns correct value', (t) => {
  const queueName = randomId('queueName');
  const queueUrl = randomId('queueUrl');
  const testMessage = {
    meta: {
      queues: {
        [queueName]: queueUrl
      }
    }
  };

  let queueNameResult = getQueueNameByUrl(testMessage, queueUrl);
  t.is(queueNameResult, queueName);

  queueNameResult = getQueueNameByUrl(testMessage, 'fake-value');
  t.is(queueNameResult, undefined);

  queueNameResult = getQueueNameByUrl({}, 'queueUrl');
  t.is(queueNameResult, undefined);
});

test('getMessageTemplate throws error if invalid S3 URI is provided', async (t) => {
  await t.throws(getMessageFromTemplate('fake-uri'));
});

test('getMessageTemplate throws error if non-existent S3 URI is provided', async (t) => {
  await t.throws(getMessageFromTemplate('s3://some-bucket/some-key'));
});

test('buildQueueMessageFromTemplate returns expected message', (t) => {
  const messageTemplate = {
    foo: 'bar',
    meta: {
      workflows: {
        workflow1: 'workflow1Template'
      }
    },
    cumulus_meta: {
      message_source: 'sfn'
    }
  };
  const provider = randomId('provider');
  const collection = randomId('collection');
  const queueName = randomId('queue');

  let actualMessage = buildQueueMessageFromTemplate({
    provider,
    collection,
    queueName,
    messageTemplate
  });

  let expectedMessage = {
    foo: 'bar',
    meta: {
      provider,
      collection,
      workflows: {
        workflow1: 'workflow1Template'
      }
    },
    cumulus_meta: {
      message_source: 'sfn',
      execution_name: executionName,
      queueName
    }
  };

  t.deepEqual(actualMessage, expectedMessage);

  const customCumulusMeta = {
    foo: 'bar',
    queueName: 'test', // should get overridden
    object: {
      key: 'value'
    }
  };
  const customMeta = {
    foo: 'bar',
    provider: 'fake-provider', // should get overridden
    collection: 'fake-collection', // should get overriden
    object: {
      key: 'value'
    }
  };
  actualMessage = buildQueueMessageFromTemplate({
    provider,
    collection,
    queueName,
    messageTemplate,
    customCumulusMeta,
    customMeta
  });

  expectedMessage = {
    foo: 'bar',
    meta: {
      provider,
      collection,
      foo: 'bar',
      object: {
        key: 'value'
      },
      workflows: {
        workflow1: 'workflow1Template'
      }
    },
    cumulus_meta: {
      message_source: 'sfn',
      execution_name: executionName,
      queueName,
      foo: 'bar',
      object: {
        key: 'value'
      }
    }
  };

  t.deepEqual(actualMessage, expectedMessage);
});

test.todo('getMessageTemplate throws error if message template body is not JSON');
