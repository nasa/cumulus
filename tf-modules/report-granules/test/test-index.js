'use strict';

const test = require('ava');
const sinon = require('sinon');

const Granule = require('@cumulus/api/models/granules');
const StepFunctions = require('@cumulus/common/StepFunctions');
const { fakeGranuleFactoryV2, fakeFileFactory } = require('@cumulus/api/lib/testUtils');
const { deconstructCollectionId } = require('@cumulus/api/lib/utils');
const { randomId, randomString, randomNumber } = require('@cumulus/common/test-utils');
const { getSnsEventMessageObject } = require('@cumulus/common/sns-event');
const { handler, getReportGranuleMessages } = require('..');


const startDate = new Date(Date.UTC(2019, 8, 1));
const stopDate = new Date(Date.UTC(2019, 8, 1, 1));
let stepFunctionsStub;
let executionName;
let granuleModel;
let timestamp;
const granuleTable = randomString();


const createFakeGranule = (granuleParams = {}, fileParams = {}) => fakeGranuleFactoryV2({
  files: [
    fakeFileFactory(fileParams),
    fakeFileFactory(fileParams),
    fakeFileFactory(fileParams)
  ],
  ...granuleParams
});

const createGranuleMessage = ({
  numberOfGranules = 1,
  cMetaParams = {},
  collectionId = `${randomId('MOD')}___${randomNumber()}`,
  granuleParams = {},
  fileParams = {}
} = {}) => ({
  cumulus_meta: {
    execution_name: executionName,
    state_machine: randomId('ingest-'),
    workflow_start_time: timestamp,
    ...cMetaParams
  },
  meta: {
    collection: deconstructCollectionId(collectionId),
    provider: {
      id: 'prov1',
      protocol: 'http',
      host: 'example.com',
      port: 443
    }
  },
  payload: {
    granules: [
      ...new Array(numberOfGranules)
    ].map(createFakeGranule.bind(null, { collectionId, ...granuleParams }, fileParams))
  }
});

const createGranuleSnsMessage = (messageObject) => ({
  EventSource: 'aws:sns',
  Sns: {
    Message: JSON.stringify(messageObject)
  }
});

test.before(async () => {
  timestamp = Date.now() - randomNumber(10000000);
  process.env.GranulesTable = granuleTable;
  granuleModel = new Granule();
  await granuleModel.createTable();

  executionName = randomString();
  stepFunctionsStub = sinon.stub(StepFunctions, 'describeExecution').returns({
    input: {},
    startDate,
    stopDate
  });
});

test.after.always(async () => {
  timestamp = undefined;
  await granuleModel.deleteTable();

  stepFunctionsStub.restore();
});

test('getReportGranuleMessages returns correct number of messages', (t) => {
  let messages = getReportGranuleMessages({
    Records: [{
      EventSource: 'aws:sns',
      Sns: {
        Message: JSON.stringify({
          cumulus_meta: {
            execution_name: 'exec123',
            state_machine: 'workflow123'
          },
          meta: {},
          payload: {}
        })
      }
    }]
  });
  t.is(messages.length, 1);
  t.is(messages[0].payload.granules, undefined);

  messages = getReportGranuleMessages({
    Records: [
      createGranuleSnsMessage(createGranuleMessage({ numberOfGranules: 4 }))
    ]
  });
  t.is(messages.length, 1);
  t.is(messages[0].payload.granules.length, 4);

  messages = getReportGranuleMessages({
    Records: [
      createGranuleSnsMessage(createGranuleMessage()),
      createGranuleSnsMessage(createGranuleMessage()),
      createGranuleSnsMessage(createGranuleMessage())
    ]
  });
  t.is(messages.length, 3);
});

test('handler correctly ignores non-granule message', async (t) => {
  const response = await handler({
    Records: [{
      EventSource: 'aws:states',
      Sns: {
        Message: JSON.stringify({
          cumulus_meta: {
            execution_name: 'exec123',
            state_machine: 'workflow123'
          },
          meta: {},
          payload: {}
        })
      }
    }]
  });
  t.deepEqual(response, []);
});

test('handler correctly creates granule record', async (t) => {
  const granuleId = randomString();
  const granuleParams = {
    granuleId
  };

  await handler({
    Records: [
      createGranuleSnsMessage(createGranuleMessage(
        { granuleParams }
      ))
    ]
  });

  const record = await granuleModel.get({ granuleId });
  t.is(typeof record.createdAt, 'number');
  t.is(record.createdAt, timestamp);
});

test('handler correctly updates granule record', async (t) => {
  const granuleId = randomString();
  const cMetaParams = {
    execution_name: randomString()
  };
  const granuleParams = {
    granuleId
  };

  await handler({
    Records: [
      createGranuleSnsMessage(createGranuleMessage(
        { cMetaParams, granuleParams }
      ))
    ]
  });
  const originalRecord = await granuleModel.get({ granuleId });

  const newExecution = randomString();
  cMetaParams.execution_name = newExecution;
  const updatedGranuleParams = {
    ...originalRecord,
    cmrLink: 'http://newcmrlink.com/12345'
  };

  await handler({
    Records: [
      createGranuleSnsMessage(createGranuleMessage(
        {
          collectionId: originalRecord.collectionId,
          cMetaParams,
          granuleParams: updatedGranuleParams
        }
      ))
    ]
  });
  const updatedRecord = await granuleModel.get({ granuleId });

  const expectedRecord = {
    ...originalRecord,
    execution: updatedRecord.execution,
    updatedAt: updatedRecord.updatedAt,
    timestamp: updatedRecord.timestamp,
    duration: updatedRecord.duration,
    cmrLink: updatedGranuleParams.cmrLink
  };

  t.deepEqual(expectedRecord, updatedRecord);
  t.true(updatedRecord.execution.includes(newExecution));
});

test('handler correctly creates multiple granule records from multi-granule message', async (t) => {
  const event = createGranuleSnsMessage(createGranuleMessage(
    { numberOfGranules: 3 }
  ));
  const granules = getSnsEventMessageObject(event).payload.granules;
  const granuleIds = granules.map((g) => g.granuleId);
  t.is(granuleIds.length, [...new Set(granuleIds)].length);
  await handler({
    Records: [
      event
    ]
  });
  await Promise.all(granules.map(async (g) => {
    const record = await granuleModel.get({ granuleId: g.granuleId });
    t.deepEqual(g.files, record.files);
    t.is(g.collectionId, record.collectionId);
    t.is(g.status, record.status);
    t.is(g.published, record.published);
    t.is(g.cmrLink, record.cmrLink);
    t.is(typeof record.createdAt, 'number');
    t.is(record.createdAt, timestamp);
  }));
});

test('handler correctly updates multiple granule records from multi-granule message', async (t) => {
  const event = createGranuleSnsMessage(createGranuleMessage(
    { numberOfGranules: 3 }
  ));
  const msgObj = getSnsEventMessageObject(event);
  const granuleIds = msgObj.payload.granules.map((g) => g.granuleId);
  t.is(granuleIds.length, [...new Set(granuleIds)].length);
  await handler({
    Records: [
      event
    ]
  });
  msgObj.payload.granules.forEach((g) => {
    g.cmrLink = `http://newcmrlink.com/${g.granuleId}`;
  });
  event.Sns.Message = JSON.stringify(msgObj);
  await handler({
    Records: [
      event
    ]
  });
  await Promise.all(granuleIds.map(async (gid) => {
    const record = await granuleModel.get({ granuleId: gid });
    t.is(record.cmrLink, `http://newcmrlink.com/${gid}`);
  }));
});
