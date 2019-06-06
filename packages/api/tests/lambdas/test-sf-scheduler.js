'use strict';

const rewire = require('rewire');
const sinon = require('sinon');
const test = require('ava');

const { SQS } = require('@cumulus/ingest/aws');
const schedule = rewire('../../lambdas/sf-scheduler');

const queueName = 'userDefinedQueueName';
const keyedItem = 'userDefinedQueueUrl';
const defaultQueueName = 'startSF';
const fakeMessageResponse = {
  meta: {
    queues: {
      [queueName]: keyedItem,
      [defaultQueueName]: 'startSFQueueUrl'
    }
  }
};
const scheduleEventTemplate = {
  collection: 'fakeCollection',
  provider: 'fakeProvider',
  cumulusMeta: {},
  payload: {},
  template: 's3://somewhere/nice'
};
const fakeCollection = {
  name: 'fakeCollection',
  version: '000'
};
const fakeProvider = {
  id: 'fakeProviderId',
  host: 'fakeHost'
};

const sqsStub = sinon.stub(SQS, 'sendMessage');

class FakeCollection {
  async get(item) {
    if (item.name !== fakeCollection.name
        || item.version !== fakeCollection.version) {
      throw new Error();
    }
    return fakeCollection;
  }
}

class FakeProvider {
  async get({ id }) {
    if (id !== fakeProvider.id) {
      throw new Error();
    }
    return fakeProvider;
  }
}

const getProvider = schedule.__get__('getProvider');
const getCollection = schedule.__get__('getCollection');

const restoreMessageFromTemplate = schedule.__set__(
  'getMessageFromTemplate',
  () => Promise.resolve(fakeMessageResponse)
);
const resetProvider = schedule.__set__('Provider', FakeProvider);
const resetCollection = schedule.__set__('Collection', FakeCollection);

test.afterEach.always(() => {
  sqsStub.resetHistory();
});

test.after.always(() => {
  resetProvider();
  resetCollection();
  restoreMessageFromTemplate();
  sqsStub.restore();
});

test.serial('getProvider returns undefined when input is falsey', async (t) => {
  const response = await getProvider(undefined);
  t.is(response, undefined);
});

test.serial('getProvider returns provider when input is a valid provider ID', async (t) => {
  const response = await getProvider(fakeProvider.id);
  t.deepEqual(response, fakeProvider);
});

test.serial('getCollection returns undefined when input is falsey', async (t) => {
  const response = await getCollection(undefined);
  t.is(response, undefined);
});

test.serial('getCollection returns collection when input is a valid collection name/version', async (t) => {
  const collectionInput = {
    name: fakeCollection.name,
    version: fakeCollection.version
  };

  const response = await getCollection(collectionInput);

  t.deepEqual(response, fakeCollection);
});

test.serial('Sends a message to SQS with queueName if queueName is defined', async (t) => {
  const scheduleInput = {
    ...scheduleEventTemplate,
    queueName,
    provider: fakeProvider.id,
    collection: {
      name: fakeCollection.name,
      version: fakeCollection.version
    }
  };
  await schedule.handleScheduleEvent(scheduleInput);

  t.is(sqsStub.calledOnce, true);

  const [targetQueueUrl, targetMessage] = sqsStub.getCall(0).args;
  t.is(targetQueueUrl, fakeMessageResponse.meta.queues[queueName]);
  t.is(targetMessage.cumulus_meta.queueName, queueName);
  t.deepEqual(targetMessage.meta.collection, fakeCollection);
  t.deepEqual(targetMessage.meta.provider, fakeProvider);
});

test.serial('Sends a message to SQS with startSF if queueName is not defined', async (t) => {
  const scheduleInput = {
    ...scheduleEventTemplate,
    provider: fakeProvider.id,
    collection: {
      name: fakeCollection.name,
      version: fakeCollection.version
    }
  };

  await schedule.handleScheduleEvent(scheduleInput);

  t.is(sqsStub.calledOnce, true);

  const [targetQueueUrl, targetMessage] = sqsStub.getCall(0).args;
  t.is(targetQueueUrl, fakeMessageResponse.meta.queues[defaultQueueName]);
  t.is(targetMessage.cumulus_meta.queueName, defaultQueueName);
  t.deepEqual(targetMessage.meta.collection, fakeCollection);
  t.deepEqual(targetMessage.meta.provider, fakeProvider);
});
