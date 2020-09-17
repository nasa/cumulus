const test = require('ava');
const sinon = require('sinon');

const S3 = require('@cumulus/aws-client/S3');
const StepFunctions = require('@cumulus/aws-client/StepFunctions');
const cmrjs = require('@cumulus/cmrjs');
const { randomId } = require('@cumulus/common/test-utils');
const { getKnexClient, localStackConnectionEnv } = require('@cumulus/db');
const { constructCollectionId } = require('@cumulus/message/Collections');

const { fakeFileFactory, fakeGranuleFactoryV2, fakeCollectionFactory } = require('../../../lib/testUtils');
const Granule = require('../../../models/granules');

const dynamoCollectionToDbCollection = (dynamoCollection) => {
  const dbCollection = {
    ...dynamoCollection,
    created_at: new Date(dynamoCollection.createdAt),
    updated_at: new Date(dynamoCollection.updatedAt),
    granuleIdValidationRegex: dynamoCollection.granuleId,
    granuleIdExtractionRegex: dynamoCollection.granuleIdExtraction,
  };

  delete dbCollection.createdAt;
  delete dbCollection.updatedAt;
  delete dbCollection.granuleId;
  delete dbCollection.granuleIdExtraction;

  return dbCollection;
};

test.before(async (t) => {
  process.env.GranulesTable = randomId('granule');

  const granuleModel = new Granule();
  t.context.granuleModel = granuleModel;
  await granuleModel.createTable();

  sinon.stub(StepFunctions, 'describeExecution')
    .callsFake(() => Promise.resolve({}));

  sinon.stub(cmrjs, 'getGranuleTemporalInfo')
    .callsFake(() => Promise.resolve({}));

  t.context.db = await getKnexClient({ env: { ...localStackConnectionEnv, KNEX_DEBUG: 'true' } });

  const collectionRecord = dynamoCollectionToDbCollection(
    fakeCollectionFactory()
  );

  await t.context.db('collections').insert(collectionRecord);

  t.context.granuleCollectionFields = {
    dataType: collectionRecord.name,
    version: collectionRecord.version,
    collectionId: constructCollectionId(
      collectionRecord.name,
      collectionRecord.version
    ),
  };
});

test('_validateAndStoreGranuleRecord() can be used to create a new running granule', async (t) => {
  const { db, granuleCollectionFields, granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({
    ...granuleCollectionFields,
    status: 'running',
  });

  await granuleModel._validateAndStoreGranuleRecord({ db, granule });

  const fetchedDynamoRecord = await granuleModel.get({ granuleId: granule.granuleId });

  t.is(fetchedDynamoRecord.status, 'running');

  const fetchedDbRecord = await db.first()
    .from('granules')
    .where({ granuleId: granule.granuleId });

  t.not(fetchedDbRecord, undefined);
  t.is(fetchedDbRecord.status, 'running');
});

test('_validateAndStoreGranuleRecord() can be used to create a new completed granule', async (t) => {
  const { db, granuleCollectionFields, granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({
    ...granuleCollectionFields,
    status: 'completed',
  });

  await granuleModel._validateAndStoreGranuleRecord({ db, granule });

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.is(fetchedItem.status, 'completed');

  const fetchedDbRecord = await db.first()
    .from('granules')
    .where({ granuleId: granule.granuleId });

  t.not(fetchedDbRecord, undefined);
  t.is(fetchedDbRecord.status, 'completed');
});

test('_validateAndStoreGranuleRecord() can be used to create a new failed granule', async (t) => {
  const { db, granuleCollectionFields, granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({
    ...granuleCollectionFields,
    status: 'failed',
  });

  await granuleModel._validateAndStoreGranuleRecord({ db, granule });

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.is(fetchedItem.status, 'failed');

  const fetchedDbRecord = await db.first()
    .from('granules')
    .where({ granuleId: granule.granuleId });

  t.not(fetchedDbRecord, undefined);
  t.is(fetchedDbRecord.status, 'failed');
});

test('_validateAndStoreGranuleRecord() can be used to update a completed granule', async (t) => {
  const { db, granuleCollectionFields, granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({
    ...granuleCollectionFields,
    status: 'completed',
  });

  await granuleModel._validateAndStoreGranuleRecord({
    db,
    granule,
  });

  const updatedGranule = {
    ...granule,
    productVolume: 500,
  };

  await granuleModel._validateAndStoreGranuleRecord({
    db,
    granule: updatedGranule,
  });

  const fetchedDynamoRecord = await granuleModel.get({
    granuleId: granule.granuleId,
  });

  t.is(fetchedDynamoRecord.status, 'completed');
  t.is(fetchedDynamoRecord.productVolume, 500);

  const fetchedDbRecord = await db.first()
    .from('granules')
    .where({ granuleId: granule.granuleId });

  t.not(fetchedDbRecord, undefined);
  t.is(fetchedDbRecord.status, 'completed');
  t.is(fetchedDbRecord.productVolume, 500);
});

test('_validateAndStoreGranuleRecord() can be used to update a failed granule', async (t) => {
  const { db, granuleCollectionFields, granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({
    ...granuleCollectionFields,
    status: 'failed',
  });

  await granuleModel._validateAndStoreGranuleRecord({
    db,
    granule,
  });
  const newError = { cause: 'fail' };
  const updatedGranule = {
    ...granule,
    error: newError,
  };

  await granuleModel._validateAndStoreGranuleRecord({
    db,
    granule: updatedGranule,
  });
  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.is(fetchedItem.status, 'failed');
  t.deepEqual(fetchedItem.error, newError);

  const fetchedDbRecord = await db.first()
    .from('granules')
    .where({ granuleId: granule.granuleId });

  t.not(fetchedDbRecord, undefined);
  t.is(fetchedDbRecord.status, 'failed');
  t.deepEqual(fetchedDbRecord.error, newError);
});

test('_validateAndStoreGranuleRecord() will allow a completed status to replace a running status for same execution', async (t) => {
  const { db, granuleCollectionFields, granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({
    ...granuleCollectionFields,
    status: 'running',
  });

  await granuleModel._validateAndStoreGranuleRecord({
    db,
    granule,
  });

  const updatedGranule = {
    ...granule,
    status: 'completed',
  };

  await granuleModel._validateAndStoreGranuleRecord({
    db,
    granule: updatedGranule,
  });
  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.is(fetchedItem.status, 'completed');

  const fetchedDbRecord = await db.first()
    .from('granules')
    .where({ granuleId: granule.granuleId });

  t.not(fetchedDbRecord, undefined);
  t.is(fetchedDbRecord.status, 'completed');
});

test('_validateAndStoreGranuleRecord() will allow a failed status to replace a running status for same execution', async (t) => {
  const { db, granuleCollectionFields, granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({
    ...granuleCollectionFields,
    status: 'running',
  });

  await granuleModel._validateAndStoreGranuleRecord({
    db,
    granule,
  });

  const updatedGranule = {
    ...granule,
    status: 'failed',
  };

  await granuleModel._validateAndStoreGranuleRecord({
    db,
    granule: updatedGranule,
  });

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.is(fetchedItem.status, 'failed');

  const fetchedDbRecord = await db.first()
    .from('granules')
    .where({ granuleId: granule.granuleId });

  t.not(fetchedDbRecord, undefined);
  t.is(fetchedDbRecord.status, 'failed');
});

test('_validateAndStoreGranuleRecord() will not allow a running status to replace a completed status for same execution', async (t) => {
  const { db, granuleCollectionFields, granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({
    ...granuleCollectionFields,
    status: 'completed',
  });

  await granuleModel._validateAndStoreGranuleRecord({
    db,
    granule,
  });

  const updatedGranule = {
    ...granule,
    status: 'running',
  };

  await granuleModel._validateAndStoreGranuleRecord({
    db,
    granule: updatedGranule,
  });

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.is(fetchedItem.status, 'completed');

  const fetchedDbRecord = await db.first()
    .from('granules')
    .where({ granuleId: granule.granuleId });

  t.not(fetchedDbRecord, undefined);
  t.is(fetchedDbRecord.status, 'completed');
});

test('_validateAndStoreGranuleRecord() will not allow a running status to replace a failed status for same execution', async (t) => {
  const { db, granuleCollectionFields, granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({
    ...granuleCollectionFields,
    status: 'failed',
  });

  await granuleModel._validateAndStoreGranuleRecord({
    db,
    granule,
  });

  const updatedGranule = {
    ...granule,
    status: 'running',
  };

  await granuleModel._validateAndStoreGranuleRecord({
    db,
    granule: updatedGranule,
  });

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.is(fetchedItem.status, 'failed');

  const fetchedDbRecord = await db.first()
    .from('granules')
    .where({ granuleId: granule.granuleId });

  t.not(fetchedDbRecord, undefined);
  t.is(fetchedDbRecord.status, 'failed');
});

test('_validateAndStoreGranuleRecord() will allow a running status to replace a completed status for a new execution', async (t) => {
  const { db, granuleCollectionFields, granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({
    ...granuleCollectionFields,
    status: 'completed',
  });

  await granuleModel._validateAndStoreGranuleRecord({
    db,
    granule,
  });

  const updatedGranule = {
    ...granule,
    execution: 'new-execution-url',
    status: 'running',
  };

  await granuleModel._validateAndStoreGranuleRecord({
    db,
    granule: updatedGranule,
  });

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.is(fetchedItem.status, 'running');

  const fetchedDbRecord = await db.first()
    .from('granules')
    .where({ granuleId: granule.granuleId });

  t.not(fetchedDbRecord, undefined);
  t.is(fetchedDbRecord.status, 'running');
});

test('_validateAndStoreGranuleRecord() will allow a running status to replace a failed status for a new execution', async (t) => {
  const { db, granuleCollectionFields, granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({
    ...granuleCollectionFields,
    status: 'failed',
  });

  await granuleModel._validateAndStoreGranuleRecord({
    db,
    granule,
  });
  const updatedGranule = {
    ...granule,
    execution: 'new-execution-url',
    status: 'running',
  };

  await granuleModel._validateAndStoreGranuleRecord({
    db,
    granule: updatedGranule,
  });

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.is(fetchedItem.status, 'running');

  const fetchedDbRecord = await db.first()
    .from('granules')
    .where({ granuleId: granule.granuleId });

  t.not(fetchedDbRecord, undefined);
  t.is(fetchedDbRecord.status, 'running');
});

test('_validateAndStoreGranuleRecord() does not throw an error for a failing record', async (t) => {
  const { db, granuleCollectionFields, granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({
    ...granuleCollectionFields,
    status: 'completed',
  });
  // granule without granuleId should fail validation
  delete granule.granuleId;

  try {
    await granuleModel._validateAndStoreGranuleRecord({
      db,
      granule,
    });
    t.pass();
  } catch (error) {
    t.fail(`Expected error not to be thrown, caught: ${error}`);
  }
});

test('storeGranulesFromCumulusMessage() stores multiple granules from Cumulus message', async (t) => {
  const { db, granuleCollectionFields, granuleModel } = t.context;

  const bucket = randomId('bucket-');
  await S3.createBucket(bucket);

  try {
    const granule1 = fakeGranuleFactoryV2({
      ...granuleCollectionFields,
      files: [fakeFileFactory({ bucket })],
    });
    const granule2 = fakeGranuleFactoryV2({
      ...granuleCollectionFields,
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
          name: granuleCollectionFields.dataType,
          version: granuleCollectionFields.version,
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

    await granuleModel.storeGranulesFromCumulusMessage({
      cumulusMessage,
      db,
    });

    t.true(await granuleModel.exists({ granuleId: granule1.granuleId }));
    t.true(await granuleModel.exists({ granuleId: granule2.granuleId }));
  } finally {
    await S3.recursivelyDeleteS3Bucket(bucket);
  }
});
