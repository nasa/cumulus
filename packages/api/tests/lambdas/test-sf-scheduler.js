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

const restoreMessageFromTemplate = schedule.__set__('getMessageFromTemplate', () => Promise.resolve(fakeMessageResponse));
const sqsStub = sinon.stub(SQS, 'sendMessage');

class FakeCollection {
  async get(item) {
    return { response: fakeCollection, args: item };
  }
}

class FakeProvider {
  async get(item) {
    return { response: fakeProvider, args: item };
  }
}

// restore functions returned from rewire.__set__ commands to be called in afterEach
let restoreList;

test.afterEach(() => {
  restoreList.map((restoreFn) => restoreFn());
  sqsStub.resetHistory();
});

test.after.always(() => {
  restoreMessageFromTemplate();
  sqsStub.restore();
});

test.serial('Sends a message to SQS with queueName if queueName is defined', async (t) => {
  restoreList = [
    schedule.__set__('getCollection', () => Promise.resolve(fakeCollection)),
    schedule.__set__('getProvider', () => Promise.resolve(fakeProvider))
  ];

  const scheduleInput = { ...scheduleEventTemplate, queueName };
  await schedule.handleScheduleEvent(scheduleInput);

  t.is(sqsStub.calledOnce, true);

  const [targetQueueUrl, targetMessage] = sqsStub.getCall(0).args;
  t.is(targetQueueUrl, fakeMessageResponse.meta.queues[queueName]);
  t.is(targetMessage.cumulus_meta.queueName, queueName);
  t.deepEqual(targetMessage.meta.collection, fakeCollection);
  t.deepEqual(targetMessage.meta.provider, fakeProvider);
});

test.serial('Sends a message to SQS with startSF if queueName is not defined', async (t) => {
  restoreList = [
    schedule.__set__('getCollection', () => Promise.resolve(fakeCollection)),
    schedule.__set__('getProvider', () => Promise.resolve(fakeProvider))
  ];

  const scheduleInput = { ...scheduleEventTemplate };
  await schedule.handleScheduleEvent(scheduleInput);

  t.is(sqsStub.calledOnce, true);

  const [targetQueueUrl, targetMessage] = sqsStub.getCall(0).args;
  t.is(targetQueueUrl, fakeMessageResponse.meta.queues[defaultQueueName]);
  t.is(targetMessage.cumulus_meta.queueName, defaultQueueName);
  t.deepEqual(targetMessage.meta.collection, fakeCollection);
  t.deepEqual(targetMessage.meta.provider, fakeProvider);
});

test.serial('getProvider returns undefined when input is falsey', async (t) => {
  const getProvider = schedule.__get__('getProvider');

  const response = await getProvider(undefined);

  t.is(response, undefined);
});

test.serial('getProvider returns provider when input is a providerId', async (t) => {
  const getProvider = schedule.__get__('getProvider');
  const restoreProvider = schedule.__set__('Provider', FakeProvider);

  restoreList = [restoreProvider];

  const { response, args } = await getProvider(fakeProvider.id);

  t.deepEqual(response, fakeProvider);
  t.is(args.id, fakeProvider.id);
});

test.serial('getCollection returns undefined when input is falsey', async (t) => {
  const getCollection = schedule.__get__('getCollection');

  const response = await getCollection(undefined);

  t.is(response, undefined);
});

test.serial('getCollection returns collection when input is a collection name/version', async (t) => {
  const getCollection = schedule.__get__('getCollection');
  const restoreCollection = schedule.__set__('Collection', FakeCollection);

  restoreList = [restoreCollection];

  const collectionInput = {
    name: fakeCollection.name,
    version: fakeCollection.version
  };

  const { response, args } = await getCollection(collectionInput);

  t.deepEqual(response, fakeCollection);
  t.deepEqual(args, collectionInput);
});
