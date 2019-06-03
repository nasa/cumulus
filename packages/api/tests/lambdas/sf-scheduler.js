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

const buildMessage = schedule.__get__('buildMessage');
const sqsStub = sinon.stub(SQS, 'sendMessage');

// restore functions returned from rewire.__set__ commands to be called in afterEach
let restoreList;

test.afterEach(() => {
  restoreList.map((restoreFn) => restoreFn());
  sqsStub.resetHistory();
});

test.after.always(() => {
  sqsStub.restore();
});

test.serial('Sends a message to SQS with queueName if queueName is defined', async (t) => {
  restoreList = [
    schedule.__set__('getMessageFromTemplate', () => Promise.resolve(fakeMessageResponse)),
    schedule.__set__('getCollection', () => Promise.resolve(fakeCollection)),
    schedule.__set__('getProvider', () => Promise.resolve(fakeProvider))
  ];

  const scheduleInput = { ...scheduleEventTemplate, queueName };
  await schedule.schedule(scheduleInput);

  t.is(sqsStub.calledOnce, true);

  const [targetQueueUrl, targetMessage] = sqsStub.getCall(0).args;
  t.is(targetQueueUrl, fakeMessageResponse.meta.queues[queueName]);
  t.is(targetMessage.cumulus_meta.queueName, queueName);
  t.deepEqual(targetMessage.meta.collection, fakeCollection);
  t.deepEqual(targetMessage.meta.provider, fakeProvider);
});

test.serial('Sends a message to SQS with startSF if queueName is not defined', async (t) => {
  restoreList = [
    schedule.__set__('getMessageFromTemplate', () => Promise.resolve(fakeMessageResponse)),
    schedule.__set__('getCollection', () => Promise.resolve(fakeCollection)),
    schedule.__set__('getProvider', () => Promise.resolve(fakeProvider))
  ];

  const scheduleInput = { ...scheduleEventTemplate };
  await schedule.schedule(scheduleInput);

  t.is(sqsStub.calledOnce, true);

  const [targetQueueUrl, targetMessage] = sqsStub.getCall(0).args;
  t.is(targetQueueUrl, fakeMessageResponse.meta.queues[defaultQueueName]);
  t.is(targetMessage.cumulus_meta.queueName, defaultQueueName);
  t.deepEqual(targetMessage.meta.collection, fakeCollection);
  t.deepEqual(targetMessage.meta.provider, fakeProvider);
});

test.serial('event has valid collection and provider', async (t) => {
  restoreList = [
    schedule.__set__('getCollection', () => Promise.resolve(fakeCollection)),
    schedule.__set__('getProvider', () => Promise.resolve(fakeProvider))
  ];

  const buildMessageEventInput = {
    ...scheduleEventTemplate,
    provider: 'fakeProvider',
    collection: 'fakeCollection'
  };

  const response = await buildMessage(buildMessageEventInput, fakeMessageResponse);

  t.deepEqual(response.meta.collection, fakeCollection);
  t.deepEqual(response.meta.provider, fakeProvider);
});

test.serial('event.meta is not overwritten by undefined event.collection|provider', async (t) => {
  restoreList = [
    schedule.__set__('getCollection', () => Promise.resolve(undefined)),
    schedule.__set__('getProvider', () => Promise.resolve(undefined))
  ];

  const buildMessageEventInput = {
    ...scheduleEventTemplate,
    meta: {
      collection: fakeCollection,
      provider: fakeProvider
    }
  };

  const response = await buildMessage(buildMessageEventInput, fakeMessageResponse);

  t.deepEqual(response.meta.collection, fakeCollection);
  t.deepEqual(response.meta.provider, fakeProvider);
});
