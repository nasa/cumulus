'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const rewire = require('rewire');

const message = rewire('..');
const {
  buildCumulusMeta,
  buildQueueMessageFromTemplate,
  getMessageFromTemplate
} = message;

const fakeId = cryptoRandomString({ length: 10 });
message.__set__('uuidv4', () => fakeId);

const randomId = (prefix) => `${prefix}${cryptoRandomString({ length: 10 })}`;

test('buildCumulusMeta returns expected object', (t) => {
  const stateMachine = randomId('states');
  const queueName = randomId('queue');
  const asyncOperationId = cryptoRandomString({ length: 10 });

  let cumulusMeta = buildCumulusMeta({
    stateMachine,
    queueName
  });

  t.deepEqual(cumulusMeta, {
    state_machine: stateMachine,
    queueName,
    execution_name: fakeId
  });

  const parentExecutionArn = randomId('parentArn');
  cumulusMeta = buildCumulusMeta({
    stateMachine,
    queueName,
    parentExecutionArn
  });

  t.deepEqual(cumulusMeta, {
    state_machine: stateMachine,
    queueName,
    parentExecutionArn,
    execution_name: fakeId
  });

  cumulusMeta = buildCumulusMeta({
    asyncOperationId,
    parentExecutionArn,
    queueName,
    stateMachine
  });

  t.deepEqual(cumulusMeta, {
    asyncOperationId,
    execution_name: fakeId,
    state_machine: stateMachine,
    parentExecutionArn,
    queueName
  });
});

test('getMessageFromTemplate throws error if invalid S3 URI is provided', async (t) => {
  await t.throwsAsync(() => getMessageFromTemplate('fake-uri'));
});

test('getMessageFromTemplate throws error if non-existent S3 URI is provided', async (t) => {
  await t.throwsAsync(() => getMessageFromTemplate('s3://some-bucket/some-key'));
});

test('buildQueueMessageFromTemplate does not overwrite contents from message template', (t) => {
  const messageTemplate = {
    foo: 'bar',
    meta: {
      template: 's3://bucket/template.json'
    },
    cumulus_meta: {
      message_source: 'sfn'
    }
  };
  const workflow = {
    name: randomId('workflow'),
    arn: randomId('arn:aws:states:wf')
  };
  const provider = randomId('provider');
  const collection = randomId('collection');
  const queueName = randomId('queue');
  const payload = {};

  const actualMessage = buildQueueMessageFromTemplate({
    provider,
    collection,
    queueName,
    messageTemplate,
    payload,
    workflow
  });

  const expectedMessage = {
    foo: 'bar',
    meta: {
      provider,
      collection,
      template: 's3://bucket/template.json',
      workflow_name: workflow.name
    },
    cumulus_meta: {
      message_source: 'sfn',
      execution_name: fakeId,
      queueName,
      state_machine: workflow.arn
    },
    payload
  };

  t.deepEqual(actualMessage, expectedMessage);
});

test('buildQueueMessageFromTemplate returns message with correct payload', (t) => {
  const messageTemplate = {};
  const workflow = {
    name: randomId('workflow'),
    arn: randomId('arn:aws:states:wf')
  };
  const provider = randomId('provider');
  const collection = randomId('collection');
  const queueName = randomId('queue');

  const granules = [{
    granule1: 'granule1'
  }];
  const payload = {
    foo: 'bar',
    granules: granules
  };

  const actualMessage = buildQueueMessageFromTemplate({
    provider,
    collection,
    queueName,
    messageTemplate,
    payload,
    workflow
  });

  const expectedMessage = {
    meta: {
      provider,
      collection,
      workflow_name: workflow.name
    },
    cumulus_meta: {
      execution_name: fakeId,
      queueName,
      state_machine: workflow.arn
    },
    payload: {
      foo: 'bar',
      granules
    }
  };

  t.deepEqual(actualMessage, expectedMessage);
});

test('buildQueueMessageFromTemplate returns expected message with undefined collection/provider', (t) => {
  const collection = {
    name: 'test_collection',
    version: '001'
  };
  const provider = {
    id: 'test_provider'
  };
  const messageTemplate = {
    meta: {
      collection, // should not be overridden
      provider // should not be overridden
    }
  };
  const workflow = {
    name: randomId('workflow'),
    arn: randomId('arn:aws:states:wf')
  };
  const queueName = randomId('queue');
  const payload = {};

  const actualMessage = buildQueueMessageFromTemplate({
    provider: undefined,
    collection: undefined,
    queueName,
    messageTemplate,
    payload,
    workflow
  });

  const expectedMessage = {
    meta: {
      provider,
      collection,
      workflow_name: workflow.name
    },
    cumulus_meta: {
      execution_name: fakeId,
      queueName,
      state_machine: workflow.arn
    },
    payload
  };

  t.deepEqual(actualMessage, expectedMessage);
});

test('buildQueueMessageFromTemplate returns expected message with defined collection/provider', (t) => {
  const messageTemplate = {
    meta: {
      provider: 'fake-provider', // should get overridden
      collection: 'fake-collection' // should get overriden
    }
  };
  const workflow = {
    name: randomId('workflow'),
    arn: randomId('arn:aws:states:wf')
  };
  const provider = randomId('provider');
  const collection = randomId('collection');
  const queueName = randomId('queue');
  const payload = {};

  const actualMessage = buildQueueMessageFromTemplate({
    provider,
    collection,
    queueName,
    messageTemplate,
    payload,
    workflow
  });

  const expectedMessage = {
    meta: {
      provider,
      collection,
      workflow_name: workflow.name
    },
    cumulus_meta: {
      execution_name: fakeId,
      queueName,
      state_machine: workflow.arn
    },
    payload
  };

  t.deepEqual(actualMessage, expectedMessage);
});

test('buildQueueMessageFromTemplate returns expected message with custom cumulus_meta and meta', (t) => {
  const messageTemplate = {};
  const provider = randomId('provider');
  const collection = randomId('collection');
  const queueName = randomId('queue');

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
  const workflow = {
    name: randomId('workflow'),
    arn: randomId('arn:aws:states:wf')
  };
  const payload = {};

  const actualMessage = buildQueueMessageFromTemplate({
    provider,
    collection,
    queueName,
    messageTemplate,
    customCumulusMeta,
    customMeta,
    payload,
    workflow
  });

  const expectedMessage = {
    meta: {
      provider,
      collection,
      foo: 'bar',
      object: {
        key: 'value'
      },
      workflow_name: workflow.name
    },
    cumulus_meta: {
      execution_name: fakeId,
      queueName,
      state_machine: workflow.arn,
      foo: 'bar',
      object: {
        key: 'value'
      }
    },
    payload
  };

  t.deepEqual(actualMessage, expectedMessage);
});

test.todo('getMessageFromTemplate throws error if message template body is not JSON');
