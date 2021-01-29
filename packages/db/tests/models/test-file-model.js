const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const { randomString, randomId } = require('@cumulus/common/test-utils');
const {
  buildS3Uri,
  createBucket,
  fileExists,
  putJsonS3Object,
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');

const {
  s3,
} = require('@cumulus/aws-client/services');

const {
  CollectionPgModel,
  GranulePgModel,
  FilePgModel,
  generateLocalTestDb,
  destroyLocalTestDb,
  fakeCollectionRecordFactory,
  fakeFileRecordFactory,
  fakeGranuleRecordFactory,
} = require('../../dist');

const { migrationDir } = require('../../../../lambdas/db-migration');

const testDbName = `file_${cryptoRandomString({ length: 10 })}`;

function createBuckets(buckets) {
  return Promise.all(buckets.map(createBucket));
}

function deleteBuckets(buckets) {
  return Promise.all(buckets.map(recursivelyDeleteS3Bucket));
}

const putObject = (params) => s3().putObject(params).promise();

let granulePgModel;

test.before(async (t) => {
  const { knexAdmin, knex } = await generateLocalTestDb(
    testDbName,
    migrationDir
  );
  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;

  const collectionPgModel = new CollectionPgModel();
  const [collectionCumulusId] = await collectionPgModel.create(
    t.context.knex,
    fakeCollectionRecordFactory()
  );

  granulePgModel = new GranulePgModel();
  const [granuleCumulusId] = await granulePgModel.create(
    t.context.knex,
    fakeGranuleRecordFactory({
      collection_cumulus_id: collectionCumulusId,
      status: 'running',
    })
  );
  // bigint for granule cumulus_id is treated as a string,
  // not number, by knex
  // see https://github.com/knex/knex/issues/387
  t.context.granuleCumulusId = Number.parseInt(granuleCumulusId, 10);

  t.context.filePgModel = new FilePgModel();
});

test.after.always(async (t) => {
  await destroyLocalTestDb({
    ...t.context,
    testDbName,
  });
});

test('FilePgModel.upsert() creates a new file record', async (t) => {
  const {
    knex,
    filePgModel,
    granuleCumulusId,
  } = t.context;

  const file = fakeFileRecordFactory({
    granule_cumulus_id: granuleCumulusId,
  });

  await filePgModel.upsert(knex, file);

  t.like(
    await filePgModel.get(knex, file),
    file
  );
});

test('FilePgModel.upsert() overwrites a file record', async (t) => {
  const {
    knex,
    filePgModel,
    granuleCumulusId,
  } = t.context;

  const file = fakeFileRecordFactory({
    granule_cumulus_id: granuleCumulusId,
    checksum_value: cryptoRandomString({ length: 3 }),
  });
  await filePgModel.create(knex, file);

  const updatedFile = {
    ...file,
    checksum_value: cryptoRandomString({ length: 3 }),
  };
  await filePgModel.upsert(knex, updatedFile);

  t.like(
    await filePgModel.get(knex, {
      bucket: file.bucket,
      key: file.key,
    }),
    updatedFile
  );
});

test('FilePgModel.delete() deletes a file record', async (t) => {});

test('FilePgModel.delete() deletes a file from S3', async (t) => {});

test('FilePgModel.deleteGranuleFiles() deletes all files belonging to a granule in PG', async (t) => {
  const {
    knex,
    filePgModel,
    granuleCumulusId,
  } = t.context;

  const files = [
    fakeFileRecordFactory({
      granule_cumulus_id: granuleCumulusId,
    }),
    fakeFileRecordFactory({
      granule_cumulus_id: granuleCumulusId,
    }),
    fakeFileRecordFactory({
      granule_cumulus_id: granuleCumulusId,
    }),
  ];

  await Promise.all(files.map((f) => filePgModel.create(knex, f)));

  const granule = await granulePgModel.get(knex, { cumulus_id: granuleCumulusId });

  await filePgModel.deleteGranuleFiles(knex, granule);

  t.false(await filePgModel.exists(knex, { granule_cumulus_id: granuleCumulusId }));
});

test('FilePgModel.deleteGranuleFiles() deletes all files belonging to a granule in S3', async (t) => {
  const {
    knex,
    filePgModel,
    granuleCumulusId,
  } = t.context;

  const buckets = {
    protected: {
      name: randomId('protected'),
      type: 'protected',
    },
    public: {
      name: randomId('public'),
      type: 'public',
    },
  };

  const files = [
    fakeFileRecordFactory({
      bucket: buckets.protected.name,
      file_name: `${granuleCumulusId}.hdf`,
      granule_cumulus_id: granuleCumulusId,
    }),
    fakeFileRecordFactory({
      bucket: buckets.protected.name,
      file_name: `${granuleCumulusId}.cmr.xml`,
      granule_cumulus_id: granuleCumulusId,
    }),
    fakeFileRecordFactory({
      bucket: buckets.public.name,
      file_name: `${granuleCumulusId}.jpg`,
      granule_cumulus_id: granuleCumulusId,
    }),
  ];

  // Add files to PG
  await Promise.all(files.map((f) => filePgModel.create(knex, f)));

  await createBuckets([
    buckets.protected.name,
    buckets.public.name,
  ]);

  // Add files to S3
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    await putObject({ // eslint-disable-line no-await-in-loop
      Bucket: file.bucket,
      Key: file.key,
      Body: `test data ${randomString()}`,
    });
  }

  // Delete files from PG and S3
  const granule = await granulePgModel.get(knex, { cumulus_id: granuleCumulusId });
  await filePgModel.deleteGranuleFiles(knex, granule);

  // PG records should have been deleted
  t.false(await filePgModel.exists(knex, { granule_cumulus_id: granuleCumulusId }));

  // S3 files should have been deleted
  /* eslint-disable no-await-in-loop */
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    t.false(await fileExists(file.bucket, file.key));
  }
  /* eslint-enable no-await-in-loop */

  await deleteBuckets([
    buckets.protected.name,
    buckets.public.name,
  ]);
});

test.skip('FilePgModel.deleteGranuleFiles() works with a transaction', async (t) => {});

test.skip('FilePgModel.deleteGranuleFiles() does not delete PG files if S3 delete fails', async (t) => {});
