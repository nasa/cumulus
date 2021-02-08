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

process.env.CollectionsTable = randomId('collection');
process.env.GranulesTable = randomId('granules');
process.env.stackName = randomId('stackname');
process.env.system_bucket = randomId('systembucket');
process.env.TOKEN_SECRET = randomId('secret');

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

test.only('deleteGranuleAndFiles() removes a granule from PG and Dynamo', async (t) => {
  const granuleId = cryptoRandomString({ length: 6 });

  // Create the same Granule in Dynamo and PG
  const newDynamoGranule = fakeGranuleFactoryV2({ granuleId: granuleId, status: 'failed' });
  const newPGGranule = fakeGranuleRecordFactory(
    {
      granule_id: granuleId,
      status: 'failed',
      collection_cumulus_id: t.context.testPgCollection.cumulus_id,
    }
  );

  newDynamoGranule.published = false;
  newPGGranule.published = false;

  // create a new unpublished granule in Dynamo
  await granuleModel.create(newDynamoGranule);

  // create a new unpublished granule in RDS
  await granulePgModel.create(t.context.knex, newPGGranule);

  await deleteGranuleAndFiles(
    t.context.knex,
    newDynamoGranule,
    newPGGranule
  );

  // Check Dynamo and RDS. The granule should have been removed from both.
  await t.throwsAsync(
    granuleModel.get({ granuleId: granuleId }),
    { instanceOf: RecordDoesNotExist }
  );

  await t.throwsAsync(
    granulePgModel.get(t.context.knex, { granule_id: granuleId }),
    { instanceOf: RecordDoesNotExist }
  );
});

test('deleteGranuleAndFiles() removes files from PG and S3', async (t) => {
  const newGranule = await createGranuleAndFiles(
    t.context.knex,
    t.context.testPgCollection.cumulus_id,
    false
  );

  const response = await request(app)
    .delete(`/granules/${newGranule.granuleId}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  t.is(response.status, 200);
  const { detail } = response.body;
  t.is(detail, 'Record deleted');

  // verify the files are deleted from S3. No need to check the Postgres files.
  // If the granule was successfully deleted, the postgres
  // files will have been as well. Files have a fk which would
  // prevent the granule from being deleted if files referencing it
  // still exist.
  /* eslint-disable no-await-in-loop */
  for (let i = 0; i < newGranule.files.length; i += 1) {
    const file = newGranule.files[i];
    t.false(await s3ObjectExists({ Bucket: file.bucket, Key: file.key }));
  }
  /* eslint-enable no-await-in-loop */

  await deleteBuckets([
    s3Buckets.protected.name,
    s3Buckets.public.name,
  ]);
});

test('deleteGranuleAndFiles() succeeds if a file is not present in S3', async (t) => {
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
  const newPGGranule = fakeGranuleRecordFactory(
    {
      granule_id: granuleId,
      status: 'failed',
      collection_cumulus_id: t.context.testPgCollection.cumulus_id,
    }
  );
  newPGGranule.published = false;
  await granulePgModel.create(t.context.knex, newPGGranule);

  const response = await request(app)
    .delete(`/granules/${newGranule.granuleId}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`);

  t.is(response.status, 200);
});

test('deleteGranuleAndFiles() will not delete a granule or its S3 files if the PG file delete fails', async (t) => {
  const newGranule = await createGranuleAndFiles(
    t.context.knex,
    t.context.testPgCollection.cumulus_id,
    false
  );

  const granuleId = newGranule.granuleId;

  // TODO make PG file delete fail

  const response = await request(app)
    .delete(`/granules/${granuleId}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(400);

  t.is(response.status, 400);
  const { message } = response.body;
  t.is(
    message,
    'You cannot delete a granule that is published to CMR. Remove it from CMR first'
  );

  // granule should still exist in Dynamo and PG
  t.true(await granulePgModel.exists(t.context.knex, { granule_id: granuleId }));
  t.true(await granuleModel.exists({ granuleId }));

  /* eslint-disable no-await-in-loop */
  for (let i = 0; i < newGranule.files.length; i += 1) {
    const file = newGranule.files[i];
    // file should still exist in S3
    t.true(await s3ObjectExists({ Bucket: file.bucket, Key: file.key }));
    // file should still exist in PG
    t.true(await filePgModel.exists(t.context.knex, { bucket: file.bucket, key: file.key }));
  }
  /* eslint-enable no-await-in-loop */
});

test('deleteGranuleAndFiles() will not delete PG Files if the PG Granule delete fails', async (t) => {});

test('deleteGranuleAndFiles() will not delete PG files or granule if the Dynamo granule delete fails', async (t) => {});
