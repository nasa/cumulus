'use strict';

const test = require('ava');
const sinon = require('sinon');

const Granule = require('@cumulus/api/models/granules');
const StepFunctions = require('@cumulus/common/StepFunctions');
const { fakeGranuleFactoryV2, fakeFileFactory } = require('@cumulus/api/lib/testUtils');
const { deconstructCollectionId } = require('@cumulus/api/lib/utils');
const { randomId, randomString, randomNumber } = require('@cumulus/common/test-utils');
const { handler, getReportGranuleMessages } = require('..');


const startDate = new Date(Date.UTC(2019, 6, 28));
const stopDate = new Date(Date.UTC(2019, 6, 28, 1));
let stepFunctionsStub;
let executionName;
let granuleModel;
const granuleTable = randomString();


const createFakeGranule = (granuleParams = {}, fileParams = {}) => fakeGranuleFactoryV2({
  ...granuleParams,
  files: [
    fakeFileFactory(fileParams),
    fakeFileFactory(fileParams),
    fakeFileFactory(fileParams)
  ]
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
  await granuleModel.deleteTable();

  stepFunctionsStub.restore();
});

test('getReportGranuleMessages returns no messages for messages with no granules', (t) => {
  let messages = getReportGranuleMessages([{}]);
  t.is(messages.length, 0);

  messages = getReportGranuleMessages([{
    Records: [{
      Sns: {}
    }]
  }]);
  t.is(messages.length, 0);

  messages = getReportGranuleMessages([{
    Records: [{
      Sns: {
        Message: 'message'
      }
    }]
  }]);
  t.is(messages.length, 0);

  messages = getReportGranuleMessages([{
    Records: [{
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
  }]);
  t.is(messages.length, 0);
});

test('getReportExecutionMessages returns correct number of messages', (t) => {
  let messages = getReportGranuleMessages({
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

test('handler correctly creates granule record', async (t) => {
  const granuleId = randomString();
  const timestamp = 100000000 + randomNumber(10000000);
  const cMetaParams = {
    workflow_start_time: timestamp
  };
  const granuleParams = {
    granuleId
  };

  await handler({
    Records: [
      createGranuleSnsMessage(createGranuleMessage(
        { numberOfGranules: 1, cMetaParams, granuleParams }
      ))
    ]
  });

  const record = await granuleModel.get({ granuleId });
  t.is(record.createdAt, timestamp);
});
