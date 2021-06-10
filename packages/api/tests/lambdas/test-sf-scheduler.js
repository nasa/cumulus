'use strict';

const rewire = require('rewire');
const sinon = require('sinon');
const test = require('ava');

const SQS = require('@cumulus/aws-client/SQS');
const schedule = rewire('../../lambdas/sf-scheduler');

const defaultQueueUrl = 'defaultQueueUrl';
const customQueueUrl = 'userDefinedQueueUrl';

const fakeMessageResponse = {
  cumulus_meta: {
    queueExecutionLimits: {
      [customQueueUrl]: 5,
    },
  },
};
const scheduleEventTemplate = {
  collection: 'fakeCollection',
  provider: 'fakeProvider',
  cumulus_meta: {},
  payload: {},
  template: fakeMessageResponse,
  definition: {},
};
const fakeCollection = {
  name: 'fakeCollection',
  version: '000',
};
const fakeProvider = {
  id: 'fakeProviderId',
  host: 'fakeHost',
};

const sqsStub = sinon.stub(SQS, 'sendSQSMessage');

class FakeCollection {
  get(item) {
    if (item.name !== fakeCollection.name
        || item.version !== fakeCollection.version) {
      return Promise.reject(new Error('Collection could not be found'));
    }
    return Promise.resolve(fakeCollection);
  }
}

const fakeGetProvider = ({ providerId }) => {
  if (providerId !== fakeProvider.id) {
    return Promise.reject(new Error('Provider could not be found'));
  }
  return Promise.resolve(fakeProvider);
};

const getApiProvider = schedule.__get__('getApiProvider');
const getCollection = schedule.__get__('getCollection');

const resetProvider = schedule.__set__('getProvider', fakeGetProvider);
const resetCollection = schedule.__set__('Collection', FakeCollection);

test.before(() => {
  process.env.defaultSchedulerQueueUrl = defaultQueueUrl;
});

test.afterEach.always(() => {
  sqsStub.resetHistory();
});

test.after.always(() => {
  resetProvider();
  resetCollection();
  sqsStub.restore();
});

test.serial('getApiProvider returns undefined when input is falsey', async (t) => {
  const response = await getApiProvider(undefined);
  t.is(response, undefined);
});

test.serial('getApiProvider returns provider when input is a valid provider ID', async (t) => {
  const response = await getApiProvider(fakeProvider.id);
  t.deepEqual(response, fakeProvider);
});

test.serial('getCollection returns undefined when input is falsey', async (t) => {
  const response = await getCollection(undefined);
  t.is(response, undefined);
});

test.serial('getCollection returns collection when input is a valid collection name/version', async (t) => {
  const collectionInput = {
    name: fakeCollection.name,
    version: fakeCollection.version,
  };

  const response = await getCollection(collectionInput);

  t.deepEqual(response, fakeCollection);
});

test.serial('Sends an SQS message to the custom queue URL if queueUrl is defined', async (t) => {
  const scheduleInput = {
    ...scheduleEventTemplate,
    queueUrl: customQueueUrl,
    provider: fakeProvider.id,
    collection: {
      name: fakeCollection.name,
      version: fakeCollection.version,
    },
  };
  await schedule.handleScheduleEvent(scheduleInput);

  t.is(sqsStub.calledOnce, true);

  const [targetQueueUrl, targetMessage] = sqsStub.getCall(0).args;
  t.is(targetQueueUrl, customQueueUrl);
  t.is(targetMessage.cumulus_meta.queueExecutionLimits[customQueueUrl], 5);
  t.deepEqual(targetMessage.meta.collection, fakeCollection);
  t.deepEqual(targetMessage.meta.provider, fakeProvider);
});

test.serial('Sends an SQS message to the default queue if queueUrl is not defined', async (t) => {
  const scheduleInput = {
    ...scheduleEventTemplate,
    provider: fakeProvider.id,
    collection: {
      name: fakeCollection.name,
      version: fakeCollection.version,
    },
  };

  await schedule.handleScheduleEvent(scheduleInput);

  t.is(sqsStub.calledOnce, true);

  const [targetQueueUrl, targetMessage] = sqsStub.getCall(0).args;
  t.is(targetQueueUrl, defaultQueueUrl);
  t.deepEqual(targetMessage.meta.collection, fakeCollection);
  t.deepEqual(targetMessage.meta.provider, fakeProvider);
});
