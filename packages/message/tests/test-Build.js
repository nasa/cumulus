'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const proxyquire = require('proxyquire');

const fakeId = cryptoRandomString({ length: 10 });
const buildUtils = proxyquire('../Build', {
  uuid: {
    v4: () => fakeId
  }
});

const {
  buildCumulusMeta,
  buildQueueMessageFromTemplate
} = buildUtils;

const randomId = (prefix) => `${prefix}${cryptoRandomString({ length: 10 })}`;

test('buildCumulusMeta returns expected object', (t) => {
  const stateMachine = randomId('states');
  const queueUrl = randomId('queue');
  const asyncOperationId = cryptoRandomString({ length: 10 });

  let cumulusMeta = buildCumulusMeta({
    stateMachine,
    queueUrl
  });

  t.deepEqual(cumulusMeta, {
    state_machine: stateMachine,
    queueUrl,
    execution_name: fakeId
  });

  const parentExecutionArn = randomId('parentArn');
  cumulusMeta = buildCumulusMeta({
    stateMachine,
    queueUrl,
    parentExecutionArn
  });

  t.deepEqual(cumulusMeta, {
    state_machine: stateMachine,
    queueUrl,
    parentExecutionArn,
    execution_name: fakeId
  });

  cumulusMeta = buildCumulusMeta({
    asyncOperationId,
    parentExecutionArn,
    queueUrl,
    stateMachine
  });

  t.deepEqual(cumulusMeta, {
    asyncOperationId,
    execution_name: fakeId,
    state_machine: stateMachine,
    parentExecutionArn,
    queueUrl
  });
});

test('buildQueueMessageFromTemplate does not overwrite contents from message template', (t) => {
  const queueUrl = randomId('queue');
  const messageTemplate = {
    foo: 'bar',
    meta: {
      template: 's3://bucket/template.json'
    },
    cumulus_meta: {
      queueExecutionLimits: {
        [queueUrl]: 5
      },
      message_source: 'sfn'
    }
  };
  const workflow = {
    name: randomId('workflow'),
    arn: randomId('arn:aws:states:wf')
  };
  const provider = randomId('provider');
  const collection = randomId('collection');
  const payload = {};

  const actualMessage = buildQueueMessageFromTemplate({
    queueUrl,
    messageTemplate,
    payload,
    workflow,
    customMeta: {
      collection,
      provider
    }
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
      queueUrl,
      queueExecutionLimits: {
        [queueUrl]: 5
      },
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
  const queueUrl = randomId('queue');

  const granules = [{
    granule1: 'granule1'
  }];
  const payload = {
    foo: 'bar',
    granules: granules
  };

  const actualMessage = buildQueueMessageFromTemplate({
    queueUrl,
    messageTemplate,
    payload,
    workflow,
    customMeta: {
      collection,
      provider
    }
  });

  const expectedMessage = {
    meta: {
      provider,
      collection,
      workflow_name: workflow.name
    },
    cumulus_meta: {
      execution_name: fakeId,
      queueUrl,
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
  const queueUrl = randomId('queue');
  const payload = {};

  const actualMessage = buildQueueMessageFromTemplate({
    queueUrl,
    messageTemplate,
    payload,
    workflow,
    customMeta: {
      provider: undefined,
      collection: undefined
    }
  });

  const expectedMessage = {
    meta: {
      provider,
      collection,
      workflow_name: workflow.name
    },
    cumulus_meta: {
      execution_name: fakeId,
      queueUrl,
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
  const queueUrl = randomId('queue');
  const payload = {};

  const actualMessage = buildQueueMessageFromTemplate({
    queueUrl,
    messageTemplate,
    payload,
    workflow,
    customMeta: {
      provider,
      collection
    }
  });

  const expectedMessage = {
    meta: {
      provider,
      collection,
      workflow_name: workflow.name
    },
    cumulus_meta: {
      execution_name: fakeId,
      queueUrl,
      state_machine: workflow.arn
    },
    payload
  };

  t.deepEqual(actualMessage, expectedMessage);
});

test('buildQueueMessageFromTemplate returns expected message with custom cumulus_meta and meta', (t) => {
  const messageTemplate = {
    meta: {
      provider: 'fake-provider', // should get overridden
      collection: 'fake-collection' // should get overriden
    }
  };
  const provider = randomId('provider');
  const collection = randomId('collection');
  const queueUrl = randomId('queue');

  const customCumulusMeta = {
    foo: 'bar',
    queueUrl: 'test', // should get overridden
    object: {
      key: 'value'
    }
  };
  const customMeta = {
    foo: 'bar',
    provider,
    collection,
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
    queueUrl,
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
      queueUrl,
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
