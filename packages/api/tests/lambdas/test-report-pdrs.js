'use strict';

const test = require('ava');

const { randomId, randomString, randomNumber } = require('@cumulus/common/test-utils');

const Pdr = require('../../models/pdrs');
const { handler, getReportPdrMessages } = require('../../lambdas/report-pdrs');

let pdrsModel;

const fakePdrRecord = {
  pdrName: randomId('pdr'),
  collectionId: randomId('collection'),
  status: 'running',
  provider: randomId('provider'),
  execution: randomString(),
  progress: 0,
  stats: {
    processing: 1,
    completed: 0,
    failed: 0,
    total: 1
  },
  PANSent: false,
  PANmessage: 'N/A',
  createdAt: Date.now(),
  timestamp: Date.now() - randomNumber(10000000)
};

const createFakePdrRecord = (pdrParams) => ({
  ...fakePdrRecord,
  ...pdrParams
});

const createPdrSnsMessage = (messageObject) => ({
  EventSource: 'aws:sns',
  Sns: {
    Message: JSON.stringify(messageObject)
  }
});

test.before(async () => {
  process.env.PdrsTable = randomString();
  pdrsModel = new Pdr();
  await pdrsModel.createTable();
});

test.after.always(async () => {
  await pdrsModel.deleteTable();
});

test('getReportPdrMessages returns correct number of messages', (t) => {
  const messages = getReportPdrMessages({
    Records: [
      createPdrSnsMessage(createFakePdrRecord())
    ]
  });
  t.is(messages.length, 1);
});

test('handler correctly creates PDR record', async (t) => {
  const pdrName = randomString();
  const status = 'running';
  const pdrParams = {
    pdrName,
    status
  };

  await handler({
    Records: [
      createPdrSnsMessage(createFakePdrRecord(
        pdrParams
      ))
    ]
  });

  const record = await pdrsModel.get({ pdrName });
  const expectedRecord = {
    ...fakePdrRecord,
    ...pdrParams,
    updatedAt: record.updatedAt
  };
  t.deepEqual(record, expectedRecord);
});

test('handler correctly updates PDR record', async (t) => {
  const pdrName = randomString();
  let status = 'running';

  const pdrParams = {
    pdrName,
    status
  };

  await handler({
    Records: [
      createPdrSnsMessage(createFakePdrRecord(
        pdrParams
      ))
    ]
  });
  const originalRecord = await pdrsModel.get({ pdrName });

  t.is(originalRecord.progress, 0);

  const newExecution = randomString();
  status = 'completed';
  const updatedStats = {
    processing: 0,
    completed: 1,
    failed: 0,
    total: 1
  };
  const updatedPdrParams = {
    ...pdrParams,
    status: 'completed',
    execution: newExecution,
    stats: updatedStats,
    progress: 100
  };

  await handler({
    Records: [
      createPdrSnsMessage(createFakePdrRecord(
        updatedPdrParams
      ))
    ]
  });
  const updatedRecord = await pdrsModel.get({ pdrName });

  const expectedRecord = {
    ...originalRecord,
    stats: updatedStats,
    progress: 100,
    status,
    execution: updatedRecord.execution,
    updatedAt: updatedRecord.updatedAt,
    timestamp: updatedRecord.timestamp
  };

  t.deepEqual(expectedRecord, updatedRecord);
  t.true(updatedRecord.execution.includes(newExecution));
});
