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

const restoreGetMessageFromTemplate = schedule.__set__('getMessageFromTemplate', () => Promise.resolve(fakeMessageResponse));
const restoreCollectionModel = schedule.__set__('getCollection', () => Promise.resolve(fakeCollection));
const restoreProviderModel = schedule.__set__('getProvider', () => Promise.resolve(fakeProvider));

const sqsStub = sinon.stub(SQS, 'sendMessage');

test.afterEach(() => {
  sqsStub.resetHistory();
});

test.after.always(() => {
  restoreGetMessageFromTemplate();
  restoreCollectionModel();
  restoreProviderModel();

  sqsStub.restore();
});

test.serial('Sends a message to SQS with queueName if queueName is defined', async (t) => {
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
  const scheduleInput = { ...scheduleEventTemplate };
  await schedule.schedule(scheduleInput);

  t.is(sqsStub.calledOnce, true);

  const [targetQueueUrl, targetMessage] = sqsStub.getCall(0).args;
  t.is(targetQueueUrl, fakeMessageResponse.meta.queues[defaultQueueName]);
  t.is(targetMessage.cumulus_meta.queueName, defaultQueueName);
  t.deepEqual(targetMessage.meta.collection, fakeCollection);
  t.deepEqual(targetMessage.meta.provider, fakeProvider);
});
