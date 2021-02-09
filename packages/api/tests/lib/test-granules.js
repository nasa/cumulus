const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const { RecordDoesNotExist } = require('@cumulus/errors');

const {
  localStackConnectionEnv,
  GranulePgModel,
  CollectionPgModel,
  FilePgModel,
  generateLocalTestDb,
} = require('@cumulus/db');

// PG mock data factories
const {
  fakeGranuleRecordFactory,
  fakeCollectionRecordFactory,
} = require('@cumulus/db/dist/test-utils');

const {
  createBucket,
  s3ObjectExists,
  createS3Buckets,
  deleteS3Buckets,
  s3PutObject,
} = require('@cumulus/aws-client/S3');

const { randomString, randomId } = require('@cumulus/common/test-utils');

const models = require('../../models');

// Dynamo mock data factories
const {
  fakeGranuleFactoryV2,
  fakeCollectionFactory,
} = require('../../lib/testUtils');

const {
  getExecutionProcessingTimeInfo,
  getGranuleTimeToArchive,
  getGranuleTimeToPreprocess,
  getGranuleProductVolume,
  deleteGranuleAndFiles,
} = require('../../lib/granules');

const { migrationDir } = require('../../../../lambdas/db-migration');

const testDbName = `granules_${cryptoRandomString({ length: 10 })}`;

const collectionId = 456;

let granuleModel;
let collectionModel;
let granulePgModel;
let filePgModel;
let s3Buckets = {};

process.env.CollectionsTable = randomId('collection');
process.env.GranulesTable = randomId('granules');
process.env.stackName = randomId('stackname');
process.env.system_bucket = randomId('systembucket');
process.env.TOKEN_SECRET = randomId('secret');

/**
 * Helper for creating a granule, and files belonging to that granule
 * @param {Knex} dbClient - Knex client
 * @param {number} collectionCumulusId - cumulus_id for the granule's parent collection
 * @param {boolean} published - if the granule should be marked published to CMR
 * @returns {Object} PG and Dynamo granules, files
 */
async function createGranuleAndFiles(dbClient, collectionCumulusId, published) {
  s3Buckets = {
    protected: {
      name: randomId('protected'),
      type: 'protected',
    },
    public: {
      name: randomId('public'),
      type: 'public',
    },
  };
  const granuleId = randomId('granule');
  const files = [
    {
      bucket: s3Buckets.protected.name,
      fileName: `${granuleId}.hdf`,
      key: `${randomString(5)}/${granuleId}.hdf`,
    },
    {
      bucket: s3Buckets.protected.name,
      fileName: `${granuleId}.cmr.xml`,
      key: `${randomString(5)}/${granuleId}.cmr.xml`,
    },
    {
      bucket: s3Buckets.public.name,
      fileName: `${granuleId}.jpg`,
      key: `${randomString(5)}/${granuleId}.jpg`,
    },
  ];

  const newGranule = fakeGranuleFactoryV2({ granuleId: granuleId, status: 'failed' });
  newGranule.published = published;
  newGranule.files = files;

  await createS3Buckets([
    s3Buckets.protected.name,
    s3Buckets.public.name,
  ]);

  // Add files to S3
  await Promise.all(newGranule.files.map((file) => s3PutObject({
    Bucket: file.bucket,
    Key: file.key,
    Body: `test data ${randomString()}`,
  })));

  // create a new Dynamo granule
  await granuleModel.create(newGranule);

  // create a new PG granule
  const newPGGranule = fakeGranuleRecordFactory(
    {
      granule_id: granuleId,
      status: 'failed',
      collection_cumulus_id: collectionCumulusId,
    }
  );
  newPGGranule.published = published;
  const [granuleCumulusId] = await granulePgModel.create(dbClient, newPGGranule);

  // create PG files
  await Promise.all(
    files.map((f) => {
      const pgFile = {
        granule_cumulus_id: granuleCumulusId,
        bucket: f.bucket,
        file_name: f.fileName,
        key: f.key,
      };

      return filePgModel.create(dbClient, pgFile);
    })
  );

  return {
    newPgGranule: await granulePgModel.get(dbClient, { cumulus_id: granuleCumulusId }),
    newDynamoGranule: await granuleModel.get({ granuleId: newGranule.granuleId }),
    files: files,
  };
}

test.before(async (t) => {
  process.env = {
    ...process.env,
    ...localStackConnectionEnv,
    PG_DATABASE: testDbName,
  };

  // create a fake bucket
  await createBucket(process.env.system_bucket);

  // create fake Collections table
  collectionModel = new models.Collection();
  await collectionModel.createTable();

  // create fake Granules table
  granuleModel = new models.Granule();
  await granuleModel.createTable();

  granulePgModel = new GranulePgModel();
  filePgModel = new FilePgModel();

  const { knex, knexAdmin } = await generateLocalTestDb(testDbName, migrationDir);
  t.context.knex = knex;
  t.context.knexAdmin = knexAdmin;

  // Create a Dynamo collection
  // we need this because a granule has a fk referring to collections
  t.context.testCollection = fakeCollectionFactory({
    name: 'fakeCollection',
    version: 'v1',
    duplicateHandling: 'error',
  });
  await collectionModel.create(t.context.testCollection);

  // Create a PG Collection
  t.context.testPgCollection = fakeCollectionRecordFactory({ cumulus_id: collectionId });
  const collectionPgModel = new CollectionPgModel();
  await collectionPgModel.create(t.context.knex, t.context.testPgCollection);
});

test.after.always(async () => {
  if (s3Buckets && s3Buckets.protected && s3Buckets.public) {
    await deleteS3Buckets([
      s3Buckets.protected.name,
      s3Buckets.public.name,
    ]);
  }
});

test('getExecutionProcessingTimeInfo() returns empty object if startDate is not provided', (t) => {
  t.deepEqual(
    getExecutionProcessingTimeInfo({}),
    {}
  );
});

test('getExecutionProcessingTimeInfo() returns correct object if stopDate is provided', (t) => {
  const startDate = new Date();
  const stopDate = new Date();
  t.deepEqual(
    getExecutionProcessingTimeInfo({
      startDate,
      stopDate,
    }),
    {
      processingStartDateTime: startDate.toISOString(),
      processingEndDateTime: stopDate.toISOString(),
    }
  );
});

test('getExecutionProcessingTimeInfo() returns correct object if stopDate is not provided', (t) => {
  const startDate = new Date();
  const now = new Date();
  t.deepEqual(
    getExecutionProcessingTimeInfo({
      startDate,
      now,
    }),
    {
      processingStartDateTime: startDate.toISOString(),
      processingEndDateTime: now.toISOString(),
    }
  );
});

test('getGranuleTimeToArchive() returns 0 if post_to_cmr_duration is missing from granule', (t) => {
  t.is(getGranuleTimeToArchive(), 0);
});

test('getGranuleTimeToArchive() returns correct duration', (t) => {
  const postToCmrDuration = 5000;
  t.is(
    getGranuleTimeToArchive({
      post_to_cmr_duration: postToCmrDuration,
    }),
    5
  );
});

test('getGranuleTimeToPreprocess() returns 0 if sync_granule_duration is missing from granule', (t) => {
  t.is(getGranuleTimeToPreprocess(), 0);
});

test('getGranuleTimeToPreprocess() returns correct duration', (t) => {
  const syncGranuleDuration = 3000;
  t.is(
    getGranuleTimeToPreprocess({
      sync_granule_duration: syncGranuleDuration,
    }),
    3
  );
});

test('getGranuleProductVolume() returns correct product volume', (t) => {
  t.is(
    getGranuleProductVolume([{
      size: 1,
    }, {
      size: 2,
    }]),
    3
  );

  t.is(
    getGranuleProductVolume([{
      foo: '1',
    }, {
      size: 'not-a-number',
    }]),
    0
  );
});

test.serial('deleteGranuleAndFiles() removes a granule from PG and Dynamo', async (t) => {
  const { newPgGranule, newDynamoGranule } = await createGranuleAndFiles(
    t.context.knex,
    t.context.testPgCollection.cumulus_id,
    false
  );

  await deleteGranuleAndFiles(
    t.context.knex,
    newDynamoGranule,
    newPgGranule,
    filePgModel,
    granulePgModel,
    granuleModel
  );

  // Check Dynamo and RDS. The granule should have been removed from both.
  await t.throwsAsync(
    granuleModel.get({ granuleId: newDynamoGranule.granuleId }),
    { instanceOf: RecordDoesNotExist }
  );

  await t.throwsAsync(
    granulePgModel.get(t.context.knex, { granule_id: newPgGranule.granule_id }),
    { instanceOf: RecordDoesNotExist }
  );
});

test.serial('deleteGranuleAndFiles() removes files from PG and S3', async (t) => {
  const { newPgGranule, newDynamoGranule, files } = await createGranuleAndFiles(
    t.context.knex,
    t.context.testPgCollection.cumulus_id,
    false
  );

  await deleteGranuleAndFiles(
    t.context.knex,
    newDynamoGranule,
    newPgGranule,
    filePgModel,
    granulePgModel,
    granuleModel
  );

  // verify the files are deleted from S3. No need to check the Postgres files.
  // If the granule was successfully deleted, the postgres
  // files will have been as well. Files have a fk which would
  // prevent the granule from being deleted if files referencing it
  // still exist.
  /* eslint-disable no-await-in-loop */
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    t.false(await s3ObjectExists({ Bucket: file.bucket, Key: file.key }));
  }
  /* eslint-enable no-await-in-loop */
});

test.serial('deleteGranuleAndFiles() succeeds if a file is not present in S3', async (t) => {
  const granuleId = randomId('granule');
  const files = [
    {
      bucket: process.env.system_bucket,
      fileName: `${granuleId}.hdf`,
      key: randomString(),
    },
  ];

  // Create Dynamo granule
  const newGranule = fakeGranuleFactoryV2({ granuleId: granuleId, status: 'failed' });
  newGranule.published = false;
  newGranule.files = files;
  await granuleModel.create(newGranule);

  // create PG granule
  const fakePGGranule = fakeGranuleRecordFactory(
    {
      granule_id: granuleId,
      status: 'failed',
      collection_cumulus_id: t.context.testPgCollection.cumulus_id,
    }
  );
  fakePGGranule.published = false;
  const [granuleCumulusId] = await granulePgModel.create(t.context.knex, fakePGGranule);

  const newPgGranule = await granulePgModel.get(t.context.knex, { cumulus_id: granuleCumulusId });
  const newDynamoGranule = await granuleModel.get({ granuleId: newGranule.granuleId });

  await deleteGranuleAndFiles(
    t.context.knex,
    newDynamoGranule,
    newPgGranule,
    filePgModel,
    granulePgModel,
    granuleModel
  );

  // Check Dynamo and RDS. The granule should have been removed from both.
  await t.throwsAsync(
    granuleModel.get({ granuleId: newDynamoGranule.granuleId }),
    { instanceOf: RecordDoesNotExist }
  );

  await t.throwsAsync(
    granulePgModel.get(t.context.knex, { granule_id: newPgGranule.granule_id }),
    { instanceOf: RecordDoesNotExist }
  );
});

test.serial('deleteGranuleAndFiles() will not delete a granule or its S3 files if the PG file delete fails', async (t) => {
  const { newPgGranule, newDynamoGranule, files } = await createGranuleAndFiles(
    t.context.knex,
    t.context.testPgCollection.cumulus_id,
    false
  );

  // make PG file delete fail
  const mockFileModel = {
    tableName: 'files',
    delete: () => {
      throw new Error('Delete failed');
    },
  };

  await t.throwsAsync(
    deleteGranuleAndFiles(
      t.context.knex,
      newDynamoGranule,
      newPgGranule,
      mockFileModel,
      granulePgModel,
      granuleModel
    ),
    { instanceOf: Error }
  );

  // granule should still exist in Dynamo and PG
  t.true(await granulePgModel.exists(t.context.knex, { granule_id: newPgGranule.granule_id }));
  t.true(await granuleModel.exists({ granuleId: newDynamoGranule.granuleId }));

  /* eslint-disable no-await-in-loop */
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    // file should still exist in S3
    t.true(await s3ObjectExists({ Bucket: file.bucket, Key: file.key }));
    // file should still exist in PG
    t.true(await filePgModel.exists(t.context.knex, { bucket: file.bucket, key: file.key }));
  }
  /* eslint-enable no-await-in-loop */
});

test.serial('deleteGranuleAndFiles() will delete PG and S3 Files if the PG Granule delete fails', async (t) => {
  const { newPgGranule, newDynamoGranule, files } = await createGranuleAndFiles(
    t.context.knex,
    t.context.testPgCollection.cumulus_id,
    false
  );

  // make PG file delete fail
  const mockGranuleModel = {
    tableName: 'granules',
    delete: () => {
      throw new Error('Delete failed');
    },
  };

  await t.throwsAsync(
    deleteGranuleAndFiles(
      t.context.knex,
      newDynamoGranule,
      newPgGranule,
      filePgModel,
      mockGranuleModel,
      granuleModel
    ),
    { instanceOf: Error }
  );

  // granule should still exist in Dynamo and PG
  t.true(await granulePgModel.exists(t.context.knex, { granule_id: newPgGranule.granule_id }));
  t.true(await granuleModel.exists({ granuleId: newDynamoGranule.granuleId }));

  // Files will have been deleted from S3 and PG.
  /* eslint-disable no-await-in-loop */
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    t.false(await s3ObjectExists({ Bucket: file.bucket, Key: file.key }));
    t.false(await filePgModel.exists(t.context.knex, { bucket: file.bucket, key: file.key }));
  }
  /* eslint-enable no-await-in-loop */
});

test.serial('deleteGranuleAndFiles() will not delete PG granule if the Dynamo granule delete fails', async (t) => {
  const { newPgGranule, newDynamoGranule, files } = await createGranuleAndFiles(
    t.context.knex,
    t.context.testPgCollection.cumulus_id,
    false
  );

  // make PG file delete fail
  const mockGranuleDynamoModel = {
    delete: () => {
      throw new Error('Delete failed');
    },
  };

  await t.throwsAsync(
    deleteGranuleAndFiles(
      t.context.knex,
      newDynamoGranule,
      newPgGranule,
      filePgModel,
      mockGranuleDynamoModel,
      granuleModel
    ),
    { instanceOf: Error }
  );

  // granule should still exist in Dynamo and PG
  t.true(await granulePgModel.exists(t.context.knex, { granule_id: newPgGranule.granule_id }));
  t.true(await granuleModel.exists({ granuleId: newDynamoGranule.granuleId }));

  // Files will have been deleted from S3 and PG.
  /* eslint-disable no-await-in-loop */
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    t.false(await s3ObjectExists({ Bucket: file.bucket, Key: file.key }));
    t.false(await filePgModel.exists(t.context.knex, { bucket: file.bucket, key: file.key }));
  }
  /* eslint-enable no-await-in-loop */
});
