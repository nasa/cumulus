const test = require('ava');
const sinon = require('sinon');

const StepFunctions = require('@cumulus/aws-client/StepFunctions');
const cmrjs = require('@cumulus/cmrjs');
const { randomId } = require('@cumulus/common/test-utils');

const { fakeFileFactory, fakeGranuleFactoryV2 } = require('../../../lib/testUtils');
const Granule = require('../../../models/granules');

test.before(async (t) => {
  process.env.GranulesTable = randomId('granule');

  const granuleModel = new Granule();
  t.context.granuleModel = granuleModel;
  await granuleModel.createTable();

  sinon.stub(StepFunctions, 'describeExecution')
    .callsFake(() => Promise.resolve({}));

  sinon.stub(cmrjs, 'getGranuleTemporalInfo')
    .callsFake(() => Promise.resolve({}));
});

test('_validateAndStoreGranuleRecord() can be used to create a new running granule', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({
    status: 'running'
  });

  await granuleModel._validateAndStoreGranuleRecord(granule);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.is(fetchedItem.status, 'running');
});

test('_validateAndStoreGranuleRecord() can be used to create a new completed granule', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2();

  await granuleModel._validateAndStoreGranuleRecord(granule);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.is(fetchedItem.status, 'completed');
});

test('_validateAndStoreGranuleRecord() can be used to create a new failed granule', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({ status: 'failed' });

  await granuleModel._validateAndStoreGranuleRecord(granule);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.is(fetchedItem.status, 'failed');
});

test('_validateAndStoreGranuleRecord() can be used to update a completed granule', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2();

  await granuleModel._validateAndStoreGranuleRecord(granule);

  const updatedGranule = {
    ...granule,
    productVolume: 500
  };

  await granuleModel._validateAndStoreGranuleRecord(updatedGranule);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.is(fetchedItem.status, 'completed');
  t.is(fetchedItem.productVolume, 500);
});

test('_validateAndStoreGranuleRecord() can be used to update a failed granule', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({ status: 'failed' });

  await granuleModel._validateAndStoreGranuleRecord(granule);

  const newError = { cause: 'fail' };
  const updatedGranule = {
    ...granule,
    error: newError
  };

  await granuleModel._validateAndStoreGranuleRecord(updatedGranule);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.is(fetchedItem.status, 'failed');
  t.deepEqual(fetchedItem.error, newError);
});

test('_validateAndStoreGranuleRecord() will allow a completed status to replace a running status for same execution', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({ status: 'running' });

  await granuleModel._validateAndStoreGranuleRecord(granule);

  const updatedGranule = {
    ...granule,
    status: 'completed'
  };

  await granuleModel._validateAndStoreGranuleRecord(updatedGranule);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.is(fetchedItem.status, 'completed');
});

test('_validateAndStoreGranuleRecord() will allow a failed status to replace a running status for same execution', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({ status: 'running' });

  await granuleModel._validateAndStoreGranuleRecord(granule);

  const updatedGranule = {
    ...granule,
    status: 'failed'
  };

  await granuleModel._validateAndStoreGranuleRecord(updatedGranule);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.is(fetchedItem.status, 'failed');
});

test('_validateAndStoreGranuleRecord() will not allow a running status to replace a completed status for same execution', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2();

  await granuleModel._validateAndStoreGranuleRecord(granule);

  const updatedGranule = {
    ...granule,
    status: 'running'
  };

  await granuleModel._validateAndStoreGranuleRecord(updatedGranule);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.is(fetchedItem.status, 'completed');
});

test('_validateAndStoreGranuleRecord() will not allow a running status to replace a failed status for same execution', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({ status: 'failed' });

  await granuleModel._validateAndStoreGranuleRecord(granule);

  const updatedGranule = {
    ...granule,
    status: 'running'
  };

  await granuleModel._validateAndStoreGranuleRecord(updatedGranule);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.is(fetchedItem.status, 'failed');
});

test('_validateAndStoreGranuleRecord() will allow a running status to replace a completed status for a new execution', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2();

  await granuleModel._validateAndStoreGranuleRecord(granule);

  const updatedGranule = {
    ...granule,
    execution: 'new-execution-url',
    status: 'running'
  };

  await granuleModel._validateAndStoreGranuleRecord(updatedGranule);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.is(fetchedItem.status, 'running');
});

test('_validateAndStoreGranuleRecord() will allow a running status to replace a failed status for a new execution', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({ status: 'failed' });

  await granuleModel._validateAndStoreGranuleRecord(granule);

  const updatedGranule = {
    ...granule,
    execution: 'new-execution-url',
    status: 'running'
  };

  await granuleModel._validateAndStoreGranuleRecord(updatedGranule);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.is(fetchedItem.status, 'running');
});

test('_validateAndStoreGranuleRecord() does not throw an error for a failing record', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2();
  // granule without granuleId should fail validation
  delete granule.granuleId;

  try {
    await granuleModel._validateAndStoreGranuleRecord(granule);
    t.pass();
  } catch (err) {
    t.fail(`Expected error not to be thrown, caught: ${err}`);
  }
});

test('storeGranulesFromCumulusMessage() stores multiple granules from Cumulus message', async (t) => {
  const { granuleModel } = t.context;

  const granule1 = fakeGranuleFactoryV2({
    files: [fakeFileFactory()]
  });
  const granule2 = fakeGranuleFactoryV2({
    files: [fakeFileFactory()]
  });

  const cumulusMessage = {
    cumulus_meta: {
      execution_name: randomId('execution'),
      state_machine: 'state-machine',
      workflow_start_time: Date.now()
    },
    meta: {
      collection: {
        name: 'name',
        version: '001'
      },
      provider: {
        host: 'example-bucket',
        protocol: 's3'
      },
      status: 'completed'
    },
    payload: {
      granules: [
        granule1,
        granule2
      ]
    }
  };

  await granuleModel.storeGranulesFromCumulusMessage(cumulusMessage);

  t.true(await granuleModel.exists({ granuleId: granule1.granuleId }));
  t.true(await granuleModel.exists({ granuleId: granule2.granuleId }));
});
