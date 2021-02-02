const test = require('ava');
const { Knex } = require('knex');
const cryptoRandomString = require('crypto-random-string');
const {
  randomString,
  randomId,
} = require('@cumulus/common/test-utils');

const {
  fileExists,
  createS3Buckets,
  deleteS3Buckets,
  s3PutObject,
} = require('@cumulus/aws-client/S3');

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

let granulePgModel;

const createFakeGranule = async (dbClient) => {
  // Collection is a required fk for granules
  const collectionPgModel = new CollectionPgModel();
  const [collectionCumulusId] = await collectionPgModel.create(
    dbClient,
    fakeCollectionRecordFactory()
  );

  granulePgModel = new GranulePgModel();
  const [granuleCumulusId] = await granulePgModel.create(
    dbClient,
    fakeGranuleRecordFactory({
      collection_cumulus_id: collectionCumulusId,
      status: 'running',
    })
  );
  // bigint for granule cumulus_id is treated as a string,
  // not number, by knex
  // see https://github.com/knex/knex/issues/387
  return Number.parseInt(granuleCumulusId, 10);
};

test.before(async (t) => {
  const { knexAdmin, knex } = await generateLocalTestDb(
    testDbName,
    migrationDir
  );
  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;

  t.context.granuleCumulusId = await createFakeGranule(t.context.knex);
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

test('FilePgModel.deleteGranuleFiles() deletes all files belonging to a granule in Postgres and S3', async (t) => {
  const {
    knex,
    filePgModel,
  } = t.context;

  const granuleCumulusId = await createFakeGranule(t.context.knex);

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

  await createS3Buckets([
    buckets.protected.name,
    buckets.public.name,
  ]);

  // Add files to S3
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    await s3PutObject({ // eslint-disable-line no-await-in-loop
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

  await deleteS3Buckets([
    buckets.protected.name,
    buckets.public.name,
  ]);
});

test('FilePgModel.deleteGranuleFiles() works with a transaction', async (t) => {
  const {
    knex,
    filePgModel,
  } = t.context;

  const granuleCumulusId = await createFakeGranule(t.context.knex);

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

  await createS3Buckets([
    buckets.protected.name,
    buckets.public.name,
  ]);

  // Add files to S3
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    await s3PutObject({ // eslint-disable-line no-await-in-loop
      Bucket: file.bucket,
      Key: file.key,
      Body: `test data ${randomString()}`,
    });
  }

  // Delete files from PG and S3 using a transaction
  const granule = await granulePgModel.get(knex, { cumulus_id: granuleCumulusId });

  await knex.transaction(
    (trx) => filePgModel.deleteGranuleFiles(trx, granule)
  );

  // PG records should have been deleted
  t.false(await filePgModel.exists(knex, { granule_cumulus_id: granuleCumulusId }));

  // S3 files should have been deleted
  /* eslint-disable no-await-in-loop */
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    t.false(await fileExists(file.bucket, file.key));
  }
  /* eslint-enable no-await-in-loop */

  await deleteS3Buckets([
    buckets.protected.name,
    buckets.public.name,
  ]);
});

test('Private function FilePgModel._deleteFilesFromS3() deletes all files from S3', async (t) => {
  const {
    filePgModel,
  } = t.context;

  const granuleCumulusId = await createFakeGranule(t.context.knex);

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

  await createS3Buckets([
    buckets.protected.name,
    buckets.public.name,
  ]);

  // Add files to S3
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    await s3PutObject({ // eslint-disable-line no-await-in-loop
      Bucket: file.bucket,
      Key: file.key,
      Body: `test data ${randomString()}`,
    });
  }

  // Delete files from S3
  await filePgModel._deleteFilesFromS3(files);

  // S3 files should have been deleted
  /* eslint-disable no-await-in-loop */
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    t.false(await fileExists(file.bucket, file.key));
  }
  /* eslint-enable no-await-in-loop */

  await deleteS3Buckets([
    buckets.protected.name,
    buckets.public.name,
  ]);
});
