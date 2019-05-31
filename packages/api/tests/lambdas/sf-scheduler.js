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

const restoreGetMessageFromTemplate = schedule.__set__('getMessageFromTemplate', () => Promise.resolve(fakeMessageResponse));

const scheduleEventTemplate = {
  meta: {},
  cumulusMeta: {},
  payload: {},
  template: 's3://somewhere/nice'
};

const sqsStub = sinon.stub(SQS, 'sendMessage');

test.afterEach(() => {
  sqsStub.resetHistory();
});

test.after.always(() => {
  restoreGetMessageFromTemplate();

  sqsStub.restore();
});

test.serial('Sends a message to SQS with queueName if queueName is defined', async (t) => {
  const scheduleInput = { ...scheduleEventTemplate, queueName };
  await schedule.schedule(scheduleInput);

  t.is(sqsStub.calledOnce, true);

  const [targetQueueUrl, targetMessage] = sqsStub.getCall(0).args;
  t.is(targetQueueUrl, fakeMessageResponse.meta.queues[queueName]);
  t.is(targetMessage.cumulus_meta.queueName, queueName);
});

test.serial('Sends a message to SQS with startSF if queueName is not defined', async (t) => {
  const scheduleInput = { ...scheduleEventTemplate };
  await schedule.schedule(scheduleInput);

  t.is(sqsStub.calledOnce, true);

  const [targetQueueUrl, targetMessage] = sqsStub.getCall(0).args;
  t.is(targetQueueUrl, fakeMessageResponse.meta.queues.startSF);
  t.is(targetMessage.cumulus_meta.queueName, defaultQueueName);
});
