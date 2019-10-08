'use strict';

const test = require('ava');
const rewire = require('rewire');
const message = rewire('../message');

const { getExecutionArn } = require('../aws');
const { constructCollectionId } = require('../collection-config-store');
const { randomId, randomString } = require('../test-utils');

const buildCumulusMeta = message.__get__('buildCumulusMeta');
const buildQueueMessageFromTemplate = message.__get__('buildQueueMessageFromTemplate');
const getMessageExecutionName = message.__get__('getMessageExecutionName');
const getMessageStateMachineArn = message.__get__('getMessageStateMachineArn');
const getMessageExecutionArn = message.__get__('getMessageExecutionArn');
const getQueueNameByUrl = message.__get__('getQueueNameByUrl');
const getMessageFromTemplate = message.__get__('getMessageFromTemplate');
const getMaximumExecutions = message.__get__('getMaximumExecutions');
const getCollectionIdFromMessage = message.__get__('getCollectionIdFromMessage');
const getMessageGranules = message.__get__('getMessageGranules');

const fakeExecutionName = randomString();
message.__set__('createExecutionName', () => fakeExecutionName);

test('buildCumulusMeta returns expected object', (t) => {
  const queueName = randomId('queue');

  let cumulusMeta = buildCumulusMeta({
    queueName
  });

  t.deepEqual(cumulusMeta, {
    queueName,
    execution_name: fakeExecutionName
  });

  const parentExecutionArn = randomId('parentArn');
  cumulusMeta = buildCumulusMeta({
    queueName,
    parentExecutionArn
  });

  t.deepEqual(cumulusMeta, {
    queueName,
    parentExecutionArn,
    execution_name: fakeExecutionName
  });
});

test('getMessageExecutionName throws error if cumulus_meta.execution_name is missing', (t) => {
  t.throws(
    () => getMessageExecutionName(),
    { message: 'cumulus_meta.execution_name not set in message' }
  );
});

test('getMessageStateMachineArn throws error if cumulus_meta.state_machine is missing', (t) => {
  t.throws(
    () => getMessageStateMachineArn(),
    { message: 'cumulus_meta.state_machine not set in message' }
  );
});

test('getMessageExecutionArn returns correct execution ARN for valid message', (t) => {
  const stateMachineArn = randomString();
  const executionName = randomString();
  const executionArn = getMessageExecutionArn({
    cumulus_meta: {
      state_machine: stateMachineArn,
      execution_name: executionName
    }
  });
  t.is(executionArn, getExecutionArn(stateMachineArn, executionName));
});

test('getMessageExecutionArn returns null for invalid message', (t) => {
  const executionArn = getMessageExecutionArn();
  t.is(executionArn, null);
});

test('getCollectionIdFromMessage returns the correct collection ID', (t) => {
  const name = 'test';
  const version = '001';
  const collectionId = getCollectionIdFromMessage({
    meta: {
      collection: {
        name,
        version
      }
    }
  });
  t.is(collectionId, constructCollectionId(name, version));
});

test('getCollectionIdFromMessage returns collection ID when meta.collection is not set', (t) => {
  const collectionId = getCollectionIdFromMessage();
  t.is(collectionId, constructCollectionId());
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

test('getMaximumExecutions returns correct value', (t) => {
  const queueName = randomId('queueName');
  const testMessage = {
    meta: {
      queueExecutionLimits: {
        [queueName]: 5
      }
    }
  };
  const maxExecutions = getMaximumExecutions(testMessage, queueName);
  t.is(maxExecutions, 5);
});

test('getMaximumExecutions throw error when queue cannot be found', (t) => {
  const testMessage = {
    meta: {
      queueExecutionLimits: {}
    }
  };
  t.throws(
    () => getMaximumExecutions(testMessage, 'testQueueName')
  );
});

test('getMessageGranules returns granules from payload.granules', (t) => {
  const granules = [{
    granuleId: randomId('granule')
  }];
  const testMessage = {
    payload: {
      granules
    }
  };
  const result = getMessageGranules(testMessage);
  t.deepEqual(result, granules);
});

test('getMessageGranules returns granules from meta.input_granules', (t) => {
  const granules = [{
    granuleId: randomId('granule')
  }];
  const testMessage = {
    meta: {
      input_granules: granules
    }
  };
  const result = getMessageGranules(testMessage);
  t.deepEqual(result, granules);
});

test('getMessageGranules returns nothing when granules are absent from message', (t) => {
  const testMessage = {};
  const result = getMessageGranules(testMessage);
  t.is(result, undefined);
});

test('getMessageTemplate throws error if invalid S3 URI is provided', async (t) => {
  await t.throwsAsync(() => getMessageFromTemplate('fake-uri'));
});

test('getMessageTemplate throws error if non-existent S3 URI is provided', async (t) => {
  await t.throwsAsync(() => getMessageFromTemplate('s3://some-bucket/some-key'));
});

test('buildQueueMessageFromTemplate does not overwrite contents from message template', (t) => {
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
  const payload = {};

  const actualMessage = buildQueueMessageFromTemplate({
    provider,
    collection,
    queueName,
    messageTemplate,
    payload
  });

  const expectedMessage = {
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
      execution_name: fakeExecutionName,
      queueName
    },
    payload
  };

  t.deepEqual(actualMessage, expectedMessage);
});

test('buildQueueMessageFromTemplate returns message with correct payload', (t) => {
  const messageTemplate = {};
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
    payload
  });

  const expectedMessage = {
    meta: {
      provider,
      collection
    },
    cumulus_meta: {
      execution_name: fakeExecutionName,
      queueName
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
  const queueName = randomId('queue');
  const payload = {};

  const actualMessage = buildQueueMessageFromTemplate({
    provider: undefined,
    collection: undefined,
    queueName,
    messageTemplate,
    payload
  });

  const expectedMessage = {
    meta: {
      provider,
      collection
    },
    cumulus_meta: {
      execution_name: fakeExecutionName,
      queueName
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
  const provider = randomId('provider');
  const collection = randomId('collection');
  const queueName = randomId('queue');
  const payload = {};

  const actualMessage = buildQueueMessageFromTemplate({
    provider,
    collection,
    queueName,
    messageTemplate,
    payload
  });

  const expectedMessage = {
    meta: {
      provider,
      collection
    },
    cumulus_meta: {
      execution_name: fakeExecutionName,
      queueName
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
  const payload = {};

  const actualMessage = buildQueueMessageFromTemplate({
    provider,
    collection,
    queueName,
    messageTemplate,
    customCumulusMeta,
    customMeta,
    payload
  });

  const expectedMessage = {
    meta: {
      provider,
      collection,
      foo: 'bar',
      object: {
        key: 'value'
      }
    },
    cumulus_meta: {
      execution_name: fakeExecutionName,
      queueName,
      foo: 'bar',
      object: {
        key: 'value'
      }
    },
    payload
  };

  t.deepEqual(actualMessage, expectedMessage);
});

test.todo('getMessageTemplate throws error if message template body is not JSON');
