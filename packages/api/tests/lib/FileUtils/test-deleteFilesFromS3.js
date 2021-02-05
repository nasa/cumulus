'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const {
  CollectionPgModel,
  GranulePgModel,
} = require('@cumulus/db');

// PG mock data factories
const {
  generateLocalTestDb,
  destroyLocalTestDb,
  fakeGranuleRecordFactory,
  fakeCollectionRecordFactory,
  fakeFileRecordFactory,
} = require('@cumulus/db/dist/test-utils');

const { randomString, randomId } = require('@cumulus/common/test-utils');

const {
  createS3Buckets,
  s3PutObject,
  s3ObjectExists,
} = require('@cumulus/aws-client/S3');

const { deleteFilesFromS3 } = require('../../../lib/FileUtils');

const { migrationDir } = require('../../../../../lambdas/db-migration');

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

const saveFilesToS3 = async (granuleCumulusId) => {
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

  return files;
};

test.before(async (t) => {
  const { knexAdmin, knex } = await generateLocalTestDb(
    testDbName,
    migrationDir
  );
  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;
});

test.after.always(async (t) => {
  await destroyLocalTestDb({
    ...t.context,
    testDbName,
  });
});

test('deleteFilesFromS3() deletes all given files from S3', async (t) => {
  const granuleCumulusId = await createFakeGranule(t.context.knex);
  const files = await saveFilesToS3(granuleCumulusId);

  /* eslint-disable no-await-in-loop */
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    t.true(await s3ObjectExists({ Bucket: file.bucket, Key: file.key }));
  }
  /* eslint-enable no-await-in-loop */

  // Delete files from S3
  await deleteFilesFromS3(files);

  // S3 files should have been deleted
  /* eslint-disable no-await-in-loop */
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    t.false(await s3ObjectExists({ Bucket: file.bucket, Key: file.key }));
  }
  /* eslint-enable no-await-in-loop */
});
