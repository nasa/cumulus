'use strict';

const rewire = require('rewire');
const sinon = require('sinon');
const test = require('ava');
const { constructCollectionId } = require('@cumulus/message/Collections');
const SQS = require('@cumulus/aws-client/SQS');
const schedule = rewire('../../lambdas/sf-scheduler');
const get = require('lodash/get');
const defaultQueueUrl = 'defaultQueueUrl';
const customQueueUrl = 'userDefinedQueueUrl';

const fakeMessageResponse = {
  cumulus_meta: {
    queueExecutionLimits: {
      [customQueueUrl]: 5,
    },
  },
  meta: {
    cmr: {
      oauthProvider: 'dummy_oauth',
      username: 'uname',
      provider: 'should_never_be_seen',
      clientId: 'clientId',
      passwordSecretName: 'passwordSecretName',
      cmrEnvironment: 'cmrEnvironment',
      cmrLimit: 'cmrLimit',
      cmrPageSize: 'cmr_page_size',
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
  cmrProvider: 'provider',
};
const fakeCollectionWithoutProvider = {
  name: 'fakeCollection',
  version: '001',
};
const fakeProvider = {
  id: 'fakeProviderId',
  host: 'fakeHost',
};

const sqsStub = sinon.stub(SQS, 'sendSQSMessage');

const fakeGetCollection = (item) => {
  const collections = {
    fakeCollection___000: fakeCollection,
    fakeCollection___001: fakeCollectionWithoutProvider,
  };
  const collection = get(
    collections,
    constructCollectionId(item.collectionName, item.collectionVersion)
  );
  if (!collection) {
    return Promise.reject(new Error('Collection could not be found'));
  }

  return Promise.resolve(collection);
};

const fakeGetProvider = ({ providerId }) => {
  if (providerId !== fakeProvider.id) {
    return Promise.reject(new Error('Provider could not be found'));
  }
  return Promise.resolve({ body: JSON.stringify(fakeProvider) });
};
const getApiProvider = schedule.__get__('getApiProvider');
const getApiCollection = schedule.__get__('getApiCollection');
const resetProvider = schedule.__set__('getProvider', fakeGetProvider);
const resetCollection = schedule.__set__('getCollection', fakeGetCollection);

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
  t.deepEqual(JSON.parse(response.body), fakeProvider);
});

test.serial('getApiCollection returns undefined when input is falsey', async (t) => {
  const response = await getApiCollection(undefined);
  t.is(response, undefined);
});

test.serial('getApiCollection returns collection when input is a valid collection name/version', async (t) => {
  const collectionInput = {
    name: fakeCollection.name,
    version: fakeCollection.version,
  };

  const response = await getApiCollection(collectionInput);

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

test.serial('throws if cmrProvider not defined in collection', async (t) => {
  const scheduleInput = {
    ...scheduleEventTemplate,
    provider: fakeCollectionWithoutProvider.id,
    collection: {
      name: fakeCollectionWithoutProvider.name,
      version: fakeCollectionWithoutProvider.version,
    },
  };
  await t.throwsAsync(schedule.handleScheduleEvent(scheduleInput), {
    message: 'no cmr_provider found for collection fakeCollection___001 all collections must configure a cmr_provider for sf to be scheduled',
  });
});

test.serial('Sends an SQS message with cmrProvider from collection', async (t) => {
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
  t.is(targetMessage.meta.cmr.provider, fakeCollection.cmrProvider);
  t.is(targetMessage.meta.cmr.username, fakeMessageResponse.meta.cmr.username);
});
