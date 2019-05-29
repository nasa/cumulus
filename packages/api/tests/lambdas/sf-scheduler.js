'use strict';

const rewire = require('rewire');
const sinon = require('sinon');
const test = require('ava');

const { SQS } = require('@cumulus/ingest/aws');
const schedule = rewire('../../lambdas/sf-scheduler');

const queueName = 'batman';
const keyedItem = 'robin';
const fakeResponse = {
  meta: {
    queues: {
    }
  }
};
fakeResponse.meta.queues[queueName] = keyedItem;

const Bucket = 'my-bucket';
const Key = 'my-key'
const restoreParseS3Uri = schedule.__set__('parseS3Uri', () => ({ Bucket, Key }));
const restoreGetS3Object = schedule.__set__('getS3Object', () => Promise.resolve({
  Body: JSON.stringify(fakeResponse)
}));

const scheduleEventTemplate = {
  meta: {},
  cumulusMeta: {},
  payload: {},
  template: 's3://somewhere/nice'
};

const sqsSpy = sinon.stub(SQS, 'sendMessage').returns(true);

test.afterEach(() => {
  sqsSpy.resetHistory();
})

test.after.always(() => {
  restoreParseS3Uri();
  restoreGetS3Object();

  sqsSpy.restore();
})

test.only('Sends a message to SQS with queueName if queueName is defined', async (t) => {
  const scheduleInput = { ...scheduleEventTemplate, queueName };
  await schedule.schedule(scheduleInput);

  t.is(sqsSpy.calledOnce, true);

  const sendMessageArgs = sqsSpy.getCall(0).args;
  console.log(sendMessageArgs[0], keyedItem);
});

test.serial('Sends a message to SQS with startSF if queueName is not defined', (t) => {
  const scheduleInput = { ...scheduleEventTemplate }
  schedule.schedule(scheduleInput);

  t.is(sqsSpy.calledOnce, true);
});
