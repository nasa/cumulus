const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const {
  createBucket,
  createS3Buckets,
  deleteS3Buckets,
  s3ObjectExists,
  s3PutObject,
} = require('@cumulus/aws-client/S3');

const {
  CollectionPgModel,
  FilePgModel,
  generateLocalTestDb,
  GranulePgModel,
  localStackConnectionEnv,
} = require('@cumulus/db');

const { DeletePublishedGranule } = require('@cumulus/errors');

// PG mock data factories
const {
  fakeCollectionRecordFactory,
  fakeGranuleRecordFactory,
} = require('@cumulus/db/dist/test-utils');

const { randomId, randomString } = require('@cumulus/common/test-utils');

const models = require('../../models');

// Dynamo mock data factories
const {
  fakeCollectionFactory,
  fakeGranuleFactoryV2,
} = require('../../lib/testUtils');

const { deleteGranuleAndFiles } = require('../../lib/granule-delete');

const { migrationDir } = require('../../../../lambdas/db-migration');

const testDbName = `granules_${cryptoRandomString({ length: 10 })}`;

let collectionModel;
let filePgModel;
let granuleModel;
let granulePgModel;

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
  const s3Buckets = {
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
      key: `${randomString(10)}/${granuleId}.hdf`,
    },
    {
      bucket: s3Buckets.protected.name,
      fileName: `${granuleId}.cmr.xml`,
      key: `${randomString(10)}/${granuleId}.cmr.xml`,
    },
    {
      bucket: s3Buckets.public.name,
      fileName: `${granuleId}.jpg`,
      key: `${randomString(10)}/${granuleId}.jpg`,
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
    s3Buckets: s3Buckets,
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
  const testPgCollection = fakeCollectionRecordFactory();
  const collectionPgModel = new CollectionPgModel();
  [t.context.collectionCumulusId] = await collectionPgModel.create(
    t.context.knex,
    testPgCollection
  );
});

test.serial('deleteGranuleAndFiles() throws an error if the granule is published', async (t) => {
  const { newPgGranule, newDynamoGranule, s3Buckets } = await createGranuleAndFiles(
    t.context.knex,
    t.context.collectionCumulusId,
    true
  );

  await t.throwsAsync(
    deleteGranuleAndFiles({
      knex: t.context.knex,
      dynamoGranule: newDynamoGranule,
      pgGranule: newPgGranule,
    }),
    { instanceOf: DeletePublishedGranule }
  );

  // Check Dynamo and RDS. The granule should still exist in both.
  t.true(await granuleModel.exists({ granuleId: newDynamoGranule.granuleId }));
  t.true(await granulePgModel.exists(t.context.knex, { granule_id: newPgGranule.granule_id }));

  t.teardown(() => deleteS3Buckets([
    s3Buckets.protected.name,
    s3Buckets.public.name,
  ]));
});

test.serial('deleteGranuleAndFiles() removes granule and files from PG, Dynamo, and S3', async (t) => {
  const {
    newPgGranule,
    newDynamoGranule,
    files,
    s3Buckets,
  } = await createGranuleAndFiles(
    t.context.knex,
    t.context.collectionCumulusId,
    false
  );

  await deleteGranuleAndFiles({
    knex: t.context.knex,
    dynamoGranule: newDynamoGranule,
    pgGranule: newPgGranule,
  });

  // Check Dynamo and RDS. The granule should have been removed from both.
  t.false(await granuleModel.exists({ granuleId: newDynamoGranule.granuleId }));
  t.false(await granulePgModel.exists(t.context.knex, { granule_id: newPgGranule.granule_id }));

  // Verify files were delete from S3 and PG
  await Promise.all(
    files.map(async (file) => {
      t.false(await s3ObjectExists({ Bucket: file.bucket, Key: file.key }));
      t.false(await filePgModel.exists(t.context.knex, { bucket: file.bucket, key: file.key }));
    })
  );

  t.teardown(() => deleteS3Buckets([
    s3Buckets.protected.name,
    s3Buckets.public.name,
  ]));
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
  const newGranule = fakeGranuleFactoryV2({ granuleId: granuleId, status: 'failed', published: false, files });
  await granuleModel.create(newGranule);

  // create PG granule
  const fakePGGranule = fakeGranuleRecordFactory(
    {
      granule_id: granuleId,
      status: 'failed',
      collection_cumulus_id: t.context.collectionCumulusId,
    }
  );
  fakePGGranule.published = false;
  const [granuleCumulusId] = await granulePgModel.create(t.context.knex, fakePGGranule);

  const newPgGranule = await granulePgModel.get(t.context.knex, { cumulus_id: granuleCumulusId });
  const newDynamoGranule = await granuleModel.get({ granuleId: newGranule.granuleId });

  await deleteGranuleAndFiles({
    knex: t.context.knex,
    dynamoGranule: newDynamoGranule,
    pgGranule: newPgGranule,
  });

  // Check Dynamo and RDS. The granule should have been removed from both.
  t.false(
    await granuleModel.exists({ granuleId: newDynamoGranule.granuleId })
  );

  t.false(
    await granulePgModel.exists(t.context.knex, { granule_id: newPgGranule.granule_id })
  );
});

test.serial('deleteGranuleAndFiles() will not delete a granule or its S3 files if the PG file delete fails', async (t) => {
  const {
    newPgGranule,
    newDynamoGranule,
    files,
    s3Buckets,
  } = await createGranuleAndFiles(
    t.context.knex,
    t.context.collectionCumulusId,
    false
  );

  const mockFileModel = {
    tableName: 'files',
    delete: () => {
      throw new Error('Delete failed');
    },
  };

  await t.throwsAsync(
    deleteGranuleAndFiles({
      knex: t.context.knex,
      dynamoGranule: newDynamoGranule,
      pgGranule: newPgGranule,
      filePgModel: mockFileModel,
    }),
    { instanceOf: Error }
  );

  // granule should still exist in Dynamo and PG
  t.true(await granulePgModel.exists(t.context.knex, { granule_id: newPgGranule.granule_id }));
  t.true(await granuleModel.exists({ granuleId: newDynamoGranule.granuleId }));

  // Verify files still exist in S3 and PG
  await Promise.all(
    files.map(async (file) => {
      t.true(await s3ObjectExists({ Bucket: file.bucket, Key: file.key }));
      t.true(await filePgModel.exists(t.context.knex, { bucket: file.bucket, key: file.key }));
    })
  );

  t.teardown(() => deleteS3Buckets([
    s3Buckets.protected.name,
    s3Buckets.public.name,
  ]));
});

test.serial('deleteGranuleAndFiles() will not delete PG or S3 Files if the PG Granule delete fails', async (t) => {
  const {
    newPgGranule,
    newDynamoGranule,
    files,
    s3Buckets,
  } = await createGranuleAndFiles(
    t.context.knex,
    t.context.collectionCumulusId,
    false
  );

  const mockGranuleModel = {
    tableName: 'granules',
    delete: () => {
      throw new Error('Delete failed');
    },
  };

  await t.throwsAsync(
    deleteGranuleAndFiles({
      knex: t.context.knex,
      dynamoGranule: newDynamoGranule,
      pgGranule: newPgGranule,
      granulePgModel: mockGranuleModel,
    }),
    { instanceOf: Error }
  );

  // granule should still exist in Dynamo and PG
  t.true(await granulePgModel.exists(t.context.knex, { granule_id: newPgGranule.granule_id }));
  t.true(await granuleModel.exists({ granuleId: newDynamoGranule.granuleId }));

  // Files will still exist in S3 and PG.
  await Promise.all(
    files.map(async (file) => {
      t.true(await s3ObjectExists({ Bucket: file.bucket, Key: file.key }));
      t.true(await filePgModel.exists(t.context.knex, { bucket: file.bucket, key: file.key }));
    })
  );

  t.teardown(() => deleteS3Buckets([
    s3Buckets.protected.name,
    s3Buckets.public.name,
  ]));
});

test.serial('deleteGranuleAndFiles() will not delete PG granule if the Dynamo granule delete fails', async (t) => {
  const {
    newPgGranule,
    newDynamoGranule,
    files,
    s3Buckets,
  } = await createGranuleAndFiles(
    t.context.knex,
    t.context.collectionCumulusId,
    false
  );

  const mockGranuleDynamoModel = {
    delete: () => {
      throw new Error('Delete failed');
    },
  };

  await t.throwsAsync(
    deleteGranuleAndFiles({
      knex: t.context.knex,
      dynamoGranule: newDynamoGranule,
      pgGranule: newPgGranule,
      granuleModelClient: mockGranuleDynamoModel,
    }),
    { instanceOf: Error }
  );

  // granule should still exist in Dynamo and PG
  t.true(await granulePgModel.exists(t.context.knex, { granule_id: newPgGranule.granule_id }));
  t.true(await granuleModel.exists({ granuleId: newDynamoGranule.granuleId }));

  // Files will still exist from S3 and PG.
  await Promise.all(
    files.map(async (file) => {
      t.true(await s3ObjectExists({ Bucket: file.bucket, Key: file.key }));
      t.true(await filePgModel.exists(t.context.knex, { bucket: file.bucket, key: file.key }));
    })
  );

  t.teardown(() => deleteS3Buckets([
    s3Buckets.protected.name,
    s3Buckets.public.name,
  ]));
});

test.serial('deleteGranuleAndFiles() does not require a Postgres Granule', async (t) => {
  // Create a granule in Dynamo only
  const s3Buckets = {
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

  const newGranule = fakeGranuleFactoryV2(
    {
      granuleId: granuleId,
      status: 'failed',
      published: false,
      files: files,
    }
  );

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

  await deleteGranuleAndFiles({
    knex: t.context.knex,
    dynamoGranule: newGranule,
    pgGranule: undefined,
  });

  // Granule should have been removed from Dynamo
  t.false(
    await granuleModel.exists({ granuleId: granuleId })
  );

  // verify the files are deleted from S3.
  await Promise.all(
    files.map(async (file) => {
      t.false(await s3ObjectExists({ Bucket: file.bucket, Key: file.key }));
    })
  );

  t.teardown(() => deleteS3Buckets([
    s3Buckets.protected.name,
    s3Buckets.public.name,
  ]));
});
