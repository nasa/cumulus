'use strict';

const test = require('ava');
const sinon = require('sinon');

const awsServices = require('@cumulus/aws-client/services');
const StepFunctions = require('@cumulus/aws-client/StepFunctions');
const { randomString } = require('@cumulus/common/test-utils');

const Granule = require('../../../models/granules');
const { fakeGranuleFactoryV2 } = require('../../../lib/testUtils');

let fakeExecution;
let testCumulusMessage;
let sandbox;

test.before(async () => {
  process.env.GranulesTable = randomString();
  await new Granule().createTable();

  testCumulusMessage = {
    cumulus_meta: {
      execution_name: randomString(),
      state_machine: 'arn:aws:states:us-east-1:123456789012:stateMachine:HelloStateMachine',
      workflow_start_time: Date.now(),
    },
    meta: {
      collection: {
        name: randomString(),
        version: randomString(),
      },
      provider: {
        host: randomString(),
        protocol: 's3',
      },
      status: 'completed',
    },
    payload: {
      granules: [
        {
          granuleId: randomString(),
          sync_granule_duration: 123,
          post_to_cmr_duration: 456,
          files: [],
        },
      ],
    },
  };

  sandbox = sinon.createSandbox();

  fakeExecution = {
    input: JSON.stringify(testCumulusMessage),
    startDate: new Date(Date.UTC(2019, 6, 28)),
    stopDate: new Date(Date.UTC(2019, 6, 28, 1)),
  };
  sandbox.stub(StepFunctions, 'describeExecution').resolves(fakeExecution);

  // Store the CMR password
  process.env.cmr_password_secret_name = randomString();
  await awsServices.secretsManager().createSecret({
    Name: process.env.cmr_password_secret_name,
    SecretString: randomString(),
  }).promise();

  // Store the launchpad passphrase
  process.env.launchpad_passphrase_secret_name = randomString();
  await awsServices.secretsManager().createSecret({
    Name: process.env.launchpad_passphrase_secret_name,
    SecretString: randomString(),
  }).promise();
});

test.beforeEach((t) => {
  t.context.granuleModel = new Granule();
});

test.after.always(async () => {
  await awsServices.secretsManager().deleteSecret({
    SecretId: process.env.cmr_password_secret_name,
    ForceDeleteWithoutRecovery: true,
  }).promise();
  await awsServices.secretsManager().deleteSecret({
    SecretId: process.env.launchpad_passphrase_secret_name,
    ForceDeleteWithoutRecovery: true,
  }).promise();
  await new Granule().deleteTable();
  sandbox.restore();
});

test('granuleAttributeScan() returns granules filtered by search params', async (t) => {
  const { granuleModel } = t.context;

  const collectionId = randomString();
  const provider = randomString();
  const status = 'running';
  const granules = [
    fakeGranuleFactoryV2({ collectionId, status }),
    fakeGranuleFactoryV2({ collectionId, status, provider }),
    fakeGranuleFactoryV2({ granuleId: 'test123', collectionId, status }),
    fakeGranuleFactoryV2({ collectionId, status: 'completed' }),
    fakeGranuleFactoryV2({ collectionId: randomString(), status: 'completed' }),
  ];
  await granuleModel.create(granules);

  const searchParams = {
    collectionId,
    status,
    updatedAt__from: Date.now() - 1000 * 30,
    updatedAt__to: Date.now(),
  };
  let granulesQueue = await granuleModel.granuleAttributeScan(searchParams);

  let fetchedGranules = await granulesQueue.empty();
  t.is(fetchedGranules.length, 3);
  t.deepEqual(
    fetchedGranules.map((g) => g.granuleId).sort(),
    granules.slice(0, 3).map((g) => g.granuleId).sort()
  );

  const searchWithGranId = {
    ...searchParams,
    granuleId: 'test',
  };

  granulesQueue = await granuleModel.granuleAttributeScan(searchWithGranId);
  fetchedGranules = await granulesQueue.empty();
  t.is(fetchedGranules.length, 1);

  const searchWithProvider = {
    ...searchParams,
    provider,
  };
  granulesQueue = await granuleModel.granuleAttributeScan(searchWithProvider);
  fetchedGranules = await granulesQueue.empty();
  t.is(fetchedGranules.length, 1);
});

test('_getMutableFieldNames() returns correct fields for running status', (t) => {
  const { granuleModel } = t.context;

  const updatedItem = {
    granuleId: randomString(),
    status: 'running',
  };

  const updateFields = granuleModel._getMutableFieldNames(updatedItem);

  t.deepEqual(updateFields, [
    'createdAt', 'updatedAt', 'timestamp', 'status', 'execution',
  ]);
});

test('_getMutableFieldNames() returns correct fields for completed status', (t) => {
  const { granuleModel } = t.context;

  const item = {
    granuleId: randomString(),
    status: 'completed',
    pdrName: 'pdr',
    files: [],
    createdAt: Date.now(),
  };

  const updateFields = granuleModel._getMutableFieldNames(item);

  t.deepEqual(updateFields, Object.keys(item));
});
