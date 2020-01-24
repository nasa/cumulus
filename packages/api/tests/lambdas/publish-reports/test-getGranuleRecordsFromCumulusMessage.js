'use strict';

const test = require('ava');
const rewire = require('rewire');
const { randomString } = require('@cumulus/common/test-utils');

const publishReports = rewire('../../../lambdas/publish-reports');

const {
  getGranuleRecordsFromCumulusMessage
} = publishReports;

test.before((t) => {
  // Not necessary for the tests to pass, but reduces error log output
  t.context.revertPublishReports = publishReports.__set__(
    'StepFunctions',
    {
      describeExecution: () => Promise.resolve({})
    }
  );
});

test.beforeEach((t) => {
  const executionName = randomString();

  const cumulusMessage = {
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
      execution_name: executionName,
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

  t.context = { executionName, cumulusMessage };
});

test.after.always((t) => t.context.revertPublishReports());

test('getGranuleRecordsFromCumulusMessage() returns the correct granule record for a Cumulus message with one granule', async (t) => {
  const { executionName, cumulusMessage } = t.context;

  const granuleRecords = await getGranuleRecordsFromCumulusMessage(cumulusMessage);

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
    timestamp: granuleRecords[0].timestamp
  };

  t.deepEqual(granuleRecords, [expectedGranule]);
});

test('getGranuleRecordsFromCumulusMessage() returns the correct granule records for a Cumulus message with multiple granules', async (t) => {
  const { cumulusMessage } = t.context;

  cumulusMessage.payload.granules = [
    { granuleId: 'granule-1', files: [] },
    { granuleId: 'granule-2', files: [] }
  ];

  const granuleRecords = await getGranuleRecordsFromCumulusMessage(cumulusMessage);

  t.is(granuleRecords.length, 2);

  const granuleIds = granuleRecords.map((g) => g.granuleId);

  t.true(granuleIds.includes('granule-1'));
  t.true(granuleIds.includes('granule-2'));
});

test('getGranuleRecordsFromCumulusMessage() returns an empty array if the Cumulus message does not contain a granules property in the payload', async (t) => {
  const { cumulusMessage } = t.context;

  delete cumulusMessage.payload.granules;

  const granuleRecords = await getGranuleRecordsFromCumulusMessage(cumulusMessage);

  t.is(granuleRecords.length, 0);
});

test('getGranuleRecordsFromCumulusMessage() returns an empty array if the Cumulus message contains an empty list of granules in the payload', async (t) => {
  const { cumulusMessage } = t.context;

  cumulusMessage.payload.granules = [];

  const granuleRecords = await getGranuleRecordsFromCumulusMessage(cumulusMessage);

  t.is(granuleRecords.length, 0);
});

test('getGranuleRecordsFromCumulusMessage() returns a granule record even if the execution history could not be retrieved', async (t) => {
  const { cumulusMessage } = t.context;

  const granuleRecords = await publishReports.__with__({
    StepFunctions: {
      describeExecution: () => Promise.reject(new Error('nope'))
    }
  })(() => getGranuleRecordsFromCumulusMessage(cumulusMessage));

  t.is(granuleRecords.length, 1);
  t.is(granuleRecords[0].granuleId, 'granule-1');
});

test('getGranuleRecordsFromCumulusMessage() returns the list of valid granules if one of the granules failed to be generated', async (t) => {
  const { cumulusMessage } = t.context;

  // Add a valid granule
  cumulusMessage.payload.granules.push({
    ...cumulusMessage.payload.granules[0],
    granuleId: 'granule-x'
  });

  // Delete the granuleId of the first granule, so that it will fail to be generated
  delete cumulusMessage.payload.granules[0].granuleId;

  const granuleRecords = await getGranuleRecordsFromCumulusMessage(cumulusMessage);

  t.is(granuleRecords.length, 1);
  t.is(granuleRecords[0].granuleId, 'granule-x');
});
