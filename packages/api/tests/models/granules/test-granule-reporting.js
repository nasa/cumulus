const test = require('ava');
const sinon = require('sinon');

const S3 = require('@cumulus/aws-client/S3');
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

test('_storeGranuleRecord() can be used to create a new running granule', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({
    status: 'running',
  });

  await granuleModel._storeGranuleRecord(granule);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.is(fetchedItem.status, 'running');
});

test('_storeGranuleRecord() can be used to create a new completed granule', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2();

  await granuleModel._storeGranuleRecord(granule);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.is(fetchedItem.status, 'completed');
});

test('_storeGranuleRecord() can be used to create a new failed granule', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({ status: 'failed' });

  await granuleModel._storeGranuleRecord(granule);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.is(fetchedItem.status, 'failed');
});

test('_storeGranuleRecord() can be used to update a completed granule', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2();

  await granuleModel._storeGranuleRecord(granule);

  const updatedGranule = {
    ...granule,
    productVolume: 500,
  };

  await granuleModel._storeGranuleRecord(updatedGranule);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.is(fetchedItem.status, 'completed');
  t.is(fetchedItem.productVolume, 500);
});

test('_storeGranuleRecord() can be used to update a failed granule', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({ status: 'failed' });

  await granuleModel._storeGranuleRecord(granule);

  const newError = { cause: 'fail' };
  const updatedGranule = {
    ...granule,
    error: newError,
  };

  await granuleModel._storeGranuleRecord(updatedGranule);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.is(fetchedItem.status, 'failed');
  t.deepEqual(fetchedItem.error, newError);
});

test('_storeGranuleRecord() will allow a completed status to replace a running status for same execution', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({ status: 'running' });

  await granuleModel._storeGranuleRecord(granule);

  const updatedGranule = {
    ...granule,
    status: 'completed',
  };

  await granuleModel._storeGranuleRecord(updatedGranule);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.is(fetchedItem.status, 'completed');
});

test('_storeGranuleRecord() will allow a failed status to replace a running status for same execution', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({ status: 'running' });

  await granuleModel._storeGranuleRecord(granule);

  const updatedGranule = {
    ...granule,
    status: 'failed',
  };

  await granuleModel._storeGranuleRecord(updatedGranule);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.is(fetchedItem.status, 'failed');
});

test('_storeGranuleRecord() will not allow a running status to replace a completed status for same execution', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2();

  await granuleModel._storeGranuleRecord(granule);

  const updatedGranule = {
    ...granule,
    status: 'running',
  };

  await t.throwsAsync(granuleModel._storeGranuleRecord(updatedGranule));

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.is(fetchedItem.status, 'completed');
});

test('_storeGranuleRecord() will not allow a running status to replace a failed status for same execution', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({ status: 'failed' });

  await granuleModel._storeGranuleRecord(granule);

  const updatedGranule = {
    ...granule,
    status: 'running',
  };

  await t.throwsAsync(granuleModel._storeGranuleRecord(updatedGranule));

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.is(fetchedItem.status, 'failed');
});

test('_storeGranuleRecord() will allow a running status to replace a completed status for a new execution', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2();

  await granuleModel._storeGranuleRecord(granule);

  const updatedGranule = {
    ...granule,
    execution: 'new-execution-url',
    status: 'running',
  };

  await granuleModel._storeGranuleRecord(updatedGranule);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.is(fetchedItem.status, 'running');
});

test('_storeGranuleRecord() will allow a running status to replace a failed status for a new execution', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({ status: 'failed' });

  await granuleModel._storeGranuleRecord(granule);

  const updatedGranule = {
    ...granule,
    execution: 'new-execution-url',
    status: 'running',
  };

  await granuleModel._storeGranuleRecord(updatedGranule);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.is(fetchedItem.status, 'running');
});

test('_validateAndStoreGranuleRecord() does throw validation error', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2();
  // granule without granuleId should fail validation
  delete granule.granuleId;

  await t.throwsAsync(granuleModel._validateAndStoreGranuleRecord(granule));
});

test('_validateAndStoreGranuleRecord() throws error for a conditional check exception', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({ status: 'failed' });

  await granuleModel._validateAndStoreGranuleRecord(granule);

  const updatedGranule = {
    ...granule,
    status: 'running',
  };

  await t.throwsAsync(granuleModel._validateAndStoreGranuleRecord(updatedGranule));
});

test('storeGranuleFromCumulusMessage() does throw an error for a failing record', async (t) => {
  const { granuleModel } = t.context;

  const granule1 = fakeGranuleFactoryV2({
    files: [fakeFileFactory()],
  });

  // cause record to fail
  delete granule1.granuleId;

  const cumulusMessage = {
    payload: {
      granules: [
        granule1,
      ],
    },
  };

  await t.throwsAsync(granuleModel.storeGranuleFromCumulusMessage({
    granule: granule1,
    cumulusMessage,
    executionDescription: {
      startDate: new Date(),
      stopDate: new Date(),
    },
    executionUrl: 'http://execution-url.com',
  }));
});

test('storeGranuleFromCumulusMessage() correctly stores granule record', async (t) => {
  const { granuleModel } = t.context;

  const bucket = randomId('bucket-');
  await S3.createBucket(bucket);
  t.teardown(() => S3.recursivelyDeleteS3Bucket(bucket));

  const granule1 = fakeGranuleFactoryV2({
    files: [fakeFileFactory({ bucket })],
  });

  await S3.s3PutObject({ Bucket: bucket, Key: granule1.files[0].key, Body: 'asdf' });

  const cumulusMessage = {
    cumulus_meta: {
      execution_name: randomId('execution'),
      state_machine: 'state-machine',
      workflow_start_time: Date.now(),
    },
    meta: {
      collection: {
        name: 'name',
        version: '001',
      },
      provider: {
        host: 'example-bucket',
        protocol: 's3',
      },
      status: 'completed',
    },
    payload: {
      granules: [
        granule1,
      ],
    },
  };

  await granuleModel.storeGranuleFromCumulusMessage({
    granule: granule1,
    cumulusMessage,
    executionDescription: {
      startDate: new Date(),
      stopDate: new Date(),
    },
    executionUrl: 'http://execution-url.com',
  });

  t.true(await granuleModel.exists({ granuleId: granule1.granuleId }));
});

test('storeGranulesFromCumulusMessage() stores multiple granules from Cumulus message', async (t) => {
  const { granuleModel } = t.context;

  const bucket = randomId('bucket-');
  await S3.createBucket(bucket);

  try {
    const granule1 = fakeGranuleFactoryV2({
      files: [fakeFileFactory({ bucket })],
    });
    const granule2 = fakeGranuleFactoryV2({
      files: [fakeFileFactory({ bucket })],
    });

    await Promise.all([
      S3.s3PutObject({ Bucket: bucket, Key: granule1.files[0].key, Body: 'asdf' }),
      S3.s3PutObject({ Bucket: bucket, Key: granule2.files[0].key, Body: 'asdf' }),
    ]);

    const cumulusMessage = {
      cumulus_meta: {
        execution_name: randomId('execution'),
        state_machine: 'state-machine',
        workflow_start_time: Date.now(),
      },
      meta: {
        collection: {
          name: 'name',
          version: '001',
        },
        provider: {
          host: 'example-bucket',
          protocol: 's3',
        },
        status: 'completed',
      },
      payload: {
        granules: [
          granule1,
          granule2,
        ],
      },
    };

    await granuleModel.storeGranulesFromCumulusMessage(cumulusMessage);

    t.true(await granuleModel.exists({ granuleId: granule1.granuleId }));
    t.true(await granuleModel.exists({ granuleId: granule2.granuleId }));
  } finally {
    await S3.recursivelyDeleteS3Bucket(bucket);
  }
});

test('storeGranulesFromCumulusMessage() handles failing and succcessful granules independently', async (t) => {
  const { granuleModel } = t.context;

  const bucket = randomId('bucket-');
  await S3.createBucket(bucket);
  t.teardown(() => S3.recursivelyDeleteS3Bucket(bucket));

  const granule1 = fakeGranuleFactoryV2({
    files: [fakeFileFactory({ bucket })],
  });
  // Missing files should cause failure to write
  const granule2 = fakeGranuleFactoryV2({
    files: undefined,
  });

  await S3.s3PutObject({ Bucket: bucket, Key: granule1.files[0].key, Body: 'asdf' });

  const cumulusMessage = {
    cumulus_meta: {
      execution_name: randomId('execution'),
      state_machine: 'state-machine',
      workflow_start_time: Date.now(),
    },
    meta: {
      collection: {
        name: 'name',
        version: '001',
      },
      provider: {
        host: 'example-bucket',
        protocol: 's3',
      },
      status: 'completed',
    },
    payload: {
      granules: [
        granule1,
        granule2,
      ],
    },
  };

  await granuleModel.storeGranulesFromCumulusMessage(cumulusMessage);

  t.true(await granuleModel.exists({ granuleId: granule1.granuleId }));
  t.false(await granuleModel.exists({ granuleId: granule2.granuleId }));
});
