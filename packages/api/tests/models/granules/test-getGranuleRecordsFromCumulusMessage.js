'use strict';

const test = require('ava');
const sinon = require('sinon');
const StepFunctions = require('@cumulus/aws-client/StepFunctions');
const { randomString } = require('@cumulus/common/test-utils');

const Granule = require('../../../models/granules');

test.before((t) => {
  t.context.describeExecutionStub = sinon.stub(StepFunctions, 'describeExecution')
    .callsFake(() => Promise.resolve({}));
});

test.beforeEach((t) => {
  t.context.executionName = randomString();

  t.context.cumulusMessage = {
    meta: {
      collection: {
        name: 'c',
        version: 'v'
      },
      provider: {
        protocol: 'https',
        host: 'example.com',
        port: 80
      }
    },
    cumulus_meta: {
      execution_name: t.context.executionName,
      state_machine: 'arn:aws:states:us-east-1:111122223333:stateMachine:HelloWorld-StateMachine',
      workflow_start_time: 123
    },
    payload: {
      granules: [
        {
          granuleId: 'granule-1',
          files: []
        }
      ]
    }
  };
});

test.after.always((t) => t.context.describeExecutionStub.restore());

test('Granule._getGranuleRecordsFromCumulusMessage() returns the correct granule record for a Cumulus message with one granule', async (t) => {
  const { executionName, cumulusMessage } = t.context;

  const granuleRecords = await Granule._getGranuleRecordsFromCumulusMessage(cumulusMessage);

  const expectedGranule = {
    collectionId: 'c___v',
    createdAt: 123,
    duration: granuleRecords[0].duration,
    error: {},
    execution: `https://console.aws.amazon.com/states/home?region=us-east-1#/executions/details/arn:aws:states:us-east-1:111122223333:execution:HelloWorld-StateMachine:${executionName}`,
    files: [],
    granuleId: 'granule-1',
    productVolume: 0,
    published: false,
    timeToArchive: 0,
    timeToPreprocess: 0,
    timestamp: granuleRecords[0].timestamp,
    updatedAt: granuleRecords[0].updatedAt
  };

  t.deepEqual(granuleRecords, [expectedGranule]);
});

test('Granule._getGranuleRecordsFromCumulusMessage() returns the correct granule records for a Cumulus message with multiple granules', async (t) => {
  const { cumulusMessage } = t.context;

  cumulusMessage.payload.granules = [
    { granuleId: 'granule-1', files: [] },
    { granuleId: 'granule-2', files: [] }
  ];

  const granuleRecords = await Granule._getGranuleRecordsFromCumulusMessage(cumulusMessage);

  t.is(granuleRecords.length, 2);

  const granuleIds = granuleRecords.map((g) => g.granuleId);

  t.true(granuleIds.includes('granule-1'));
  t.true(granuleIds.includes('granule-2'));
});

test('Granule._getGranuleRecordsFromCumulusMessage() returns an empty array if the Cumulus message does not contain a granules property in the payload', async (t) => {
  const { cumulusMessage } = t.context;

  delete cumulusMessage.payload.granules;

  const granuleRecords = await Granule._getGranuleRecordsFromCumulusMessage(cumulusMessage);

  t.is(granuleRecords.length, 0);
});

test('Granule._getGranuleRecordsFromCumulusMessage() returns an empty array if the Cumulus message contains an empty list of granules in the payload', async (t) => {
  const { cumulusMessage } = t.context;

  cumulusMessage.payload.granules = [];

  const granuleRecords = await Granule._getGranuleRecordsFromCumulusMessage(cumulusMessage);

  t.is(granuleRecords.length, 0);
});

test.serial('Granule._getGranuleRecordsFromCumulusMessage() returns a granule record even if the execution history could not be retrieved', async (t) => {
  const { cumulusMessage } = t.context;

  t.context.describeExecutionStub.restore();
  t.context.describeExecutionStub = sinon.stub(StepFunctions, 'describeExecution')
    .callsFake(() => Promise.reject(new Error('nope')));
  const granuleRecords = await Granule._getGranuleRecordsFromCumulusMessage(cumulusMessage);

  t.is(granuleRecords.length, 1);
  t.is(granuleRecords[0].granuleId, 'granule-1');
});

test('Granule._getGranuleRecordsFromCumulusMessage() returns the list of valid granules if one of the granules failed to be generated', async (t) => {
  const { cumulusMessage } = t.context;

  // Add a valid granule
  cumulusMessage.payload.granules.push({
    ...cumulusMessage.payload.granules[0],
    granuleId: 'granule-x'
  });

  // Delete the granuleId of the first granule, so that it will fail to be generated
  delete cumulusMessage.payload.granules[0].granuleId;

  const granuleRecords = await Granule._getGranuleRecordsFromCumulusMessage(cumulusMessage);

  t.is(granuleRecords.length, 1);
  t.is(granuleRecords[0].granuleId, 'granule-x');
});
