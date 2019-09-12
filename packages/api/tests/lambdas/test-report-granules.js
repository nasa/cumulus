'use strict';

const test = require('ava');

const { randomId, randomString, randomNumber } = require('@cumulus/common/test-utils');

const { handler, getReportGranuleMessages } = require('../../lambdas/report-granules');
const { fakeFileFactory } = require('../../lib/testUtils');
const Granule = require('../../models/granules');

let granuleModel;
const granuleTable = randomString();

const fakeGranuleRecord = {
  pdrName: randomId('pdr'),
  collectionId: randomId('collection'),
  status: 'completed',
  provider: randomId('provider'),
  execution: randomString(),
  cmrLink: 'http://cmrLink/12345',
  files: [
    fakeFileFactory(),
    fakeFileFactory(),
    fakeFileFactory()
  ],
  error: {
    Error: 'Error',
    Cause: 'Workflow failed'
  },
  createdAt: Date.now(),
  timestamp: Date.now() - randomNumber(10000000),
  timeToPreprocess: 0.123,
  timeToArchive: 0.123,
  processingStartDateTime: '2019-07-28T00:00:00.000Z',
  processingEndDateTime: '2019-07-28T01:00:00.000Z',
  published: true
};

const createFakeGranuleRecord = (granuleParams) => ({
  ...fakeGranuleRecord,
  ...granuleParams
});

const createGranuleSnsMessage = (messageObject) => ({
  EventSource: 'aws:sns',
  Sns: {
    Message: JSON.stringify(messageObject)
  }
});

test.before(async () => {
  process.env.GranulesTable = granuleTable;
  granuleModel = new Granule();
  await granuleModel.createTable();
});

test.after.always(async () => {
  await granuleModel.deleteTable();
});

test('getReportGranuleMessages returns correct number of messages', (t) => {
  const messages = getReportGranuleMessages({
    Records: [
      createGranuleSnsMessage(createFakeGranuleRecord()),
      createGranuleSnsMessage(createFakeGranuleRecord()),
      createGranuleSnsMessage(createFakeGranuleRecord())
    ]
  });
  t.is(messages.length, 3);
});

test('handler correctly creates granule record', async (t) => {
  const granuleId = randomString();
  const createdAt = Date.now();
  const granuleParams = {
    granuleId,
    createdAt
  };

  await handler({
    Records: [
      createGranuleSnsMessage(createFakeGranuleRecord(
        granuleParams
      ))
    ]
  });

  const record = await granuleModel.get({ granuleId });
  const expectedRecord = {
    ...fakeGranuleRecord,
    ...granuleParams,
    updatedAt: record.updatedAt
  };
  t.deepEqual(record, expectedRecord);
});

test('handler correctly updates granule record', async (t) => {
  const granuleId = randomString();
  const granuleParams = {
    granuleId
  };

  await handler({
    Records: [
      createGranuleSnsMessage(
        createFakeGranuleRecord(granuleParams)
      )
    ]
  });
  const originalRecord = await granuleModel.get({ granuleId });

  const newExecution = randomString();
  const updatedGranuleParams = {
    ...originalRecord,
    execution: newExecution,
    cmrLink: 'http://newcmrlink.com/12345'
  };

  await handler({
    Records: [
      createGranuleSnsMessage(updatedGranuleParams)
    ]
  });

  const updatedRecord = await granuleModel.get({ granuleId });

  const expectedRecord = {
    ...originalRecord,
    execution: updatedRecord.execution,
    updatedAt: updatedRecord.updatedAt,
    timestamp: updatedRecord.timestamp,
    cmrLink: updatedGranuleParams.cmrLink
  };

  t.deepEqual(expectedRecord, updatedRecord);
  t.true(updatedRecord.execution.includes(newExecution));
});
