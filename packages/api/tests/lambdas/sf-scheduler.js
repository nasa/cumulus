'use strict';

const rewire = require('rewire');
const sinon = require('sinon');
const test = require('ava');

const { SQS } = require('@cumulus/ingest/aws');
const schedule = rewire('../../lambdas/sf-scheduler');

const queueName = 'batman';
const keyedItem = 'robin';
const fakeS3Response = {
  meta: {
    queues: {
      [queueName]: keyedItem,
      startSF: 'startSF'
    }
  }
};

const Bucket = 'my-bucket';
const Key = 'my-key';
const restoreParseS3Uri = schedule.__set__('parseS3Uri', () => ({ Bucket, Key }));
const restoreGetS3Object = schedule.__set__('getS3Object', () => Promise.resolve({
  Body: JSON.stringify(fakeS3Response)
}));

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
  restoreParseS3Uri();
  restoreGetS3Object();

  sqsStub.restore();
});

test.serial('Sends a message to SQS with queueName if queueName is defined', async (t) => {
  const scheduleInput = { ...scheduleEventTemplate, queueName };
  await schedule.schedule(scheduleInput);

  t.is(sqsStub.calledOnce, true);

  const [targetQueueName] = sqsStub.getCall(0).args;
  t.is(targetQueueName, fakeS3Response.meta.queues[queueName]);
});

test.serial('Sends a message to SQS with startSF if queueName is not defined', async (t) => {
  const scheduleInput = { ...scheduleEventTemplate };
  await schedule.schedule(scheduleInput);

  t.is(sqsStub.calledOnce, true);

  const [targetQueueName] = sqsStub.getCall(0).args;
  t.is(targetQueueName, 'startSF');
});
