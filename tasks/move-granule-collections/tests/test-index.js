'use strict';

const fs = require('fs');
const path = require('path');
const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const { s3 } = require('@cumulus/aws-client/services');
const {
  buildS3Uri,
  recursivelyDeleteS3Bucket,
  putJsonS3Object,
  s3ObjectExists,
  promiseS3Upload,
  parseS3Uri,
} = require('@cumulus/aws-client/S3');
const {
  randomId, validateOutput,
} = require('@cumulus/common/test-utils');
const {
  localStackConnectionEnv,
  CollectionPgModel,
  GranulePgModel,
  translateApiCollectionToPostgresCollection,
  translateApiGranuleToPostgresGranule,
  migrationDir,
  generateLocalTestDb,
  destroyLocalTestDb,
} = require('@cumulus/db');
const { getDistributionBucketMapKey } = require('@cumulus/distribution-utils');
const { isECHO10Filename, isISOFilename } = require('@cumulus/cmrjs/cmr-utils');

const { moveGranules } = require('..');

async function uploadFiles(files) {
  await Promise.all(files.map((file) => {
    let body;
    if (isECHO10Filename(file)) {
      body = fs.createReadStream('tests/data/meta.xml');
    } else if (isISOFilename(file)) {
      body = fs.createReadStream('tests/data/meta.iso.xml');
    } else {
      body = parseS3Uri(file).Key;
    }
    return promiseS3Upload({
      params: {
        Bucket: parseS3Uri(file).Bucket,
        Key: parseS3Uri(file).Key,
        Body: body,
      },
    });
  }));
}

async function setupPGData(granules, targetCollection, knex) {
  const granuleModel = new GranulePgModel();
  const collectionModel = new CollectionPgModel();
  const collectionPath = path.join(__dirname, 'data', 'original_collection.json');
  const sourceCollection = JSON.parse(fs.readFileSync(collectionPath));
  const pgRecords = {};
  await collectionModel.create(
    knex,
    translateApiCollectionToPostgresCollection(sourceCollection)
  );
  [pgRecords.targetCollection] = await collectionModel.create(
    knex,
    translateApiCollectionToPostgresCollection(targetCollection)
  );
  pgRecords.granules = await granuleModel.insert(
    knex,
    await Promise.all(granules.map(async (g) => (
      await translateApiGranuleToPostgresGranule({ dynamoRecord: g, knexOrTransaction: knex })
    )))
  );
  return pgRecords;
}

function granulesToFileURIs(granules) {
  const files = granules.reduce((arr, g) => arr.concat(g.files), []);
  return files.map((file) => buildS3Uri(file.bucket, file.key));
}

function buildPayload(t, collection) {
  const newPayload = t.context.payload;
  newPayload.config.collection = collection;
  newPayload.config.bucket = t.context.stagingBucket;
  newPayload.config.buckets.internal.name = t.context.stagingBucket;
  newPayload.config.buckets.public.name = t.context.publicBucket;
  newPayload.config.buckets.private.name = t.context.privateBucket;
  newPayload.config.buckets.protected.name = t.context.protectedBucket;
  newPayload.input.granules.forEach((granule) => {
    granule.files?.forEach(
      (file) => {
        file.fileName = file.key.split('/').pop();
      }
    );
  });
  return newPayload;
}

test.beforeEach(async (t) => {
  const testDbName = `move-granule-collections${cryptoRandomString({ length: 10 })}`;
  const { knexAdmin, knex } = await generateLocalTestDb(
    testDbName,
    migrationDir
  );
  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;
  t.context.publicBucket = randomId('public');
  t.context.protectedBucket = randomId('protected');
  t.context.privateBucket = randomId('private');
  t.context.systemBucket = randomId('system');
  t.context.stackName = 'moveGranulesTestStack';
  const bucketMapping = {
    public: t.context.publicBucket,
    protected: t.context.protectedBucket,
    private: t.context.privateBucket,

  };
  t.context.bucketMapping = bucketMapping;
  await Promise.all([
    s3().createBucket({ Bucket: t.context.publicBucket }),
    s3().createBucket({ Bucket: t.context.protectedBucket }),
    s3().createBucket({ Bucket: t.context.privateBucket }),
    s3().createBucket({ Bucket: t.context.systemBucket }),
  ]);
  process.env = {
    ...process.env,
    ...localStackConnectionEnv,
    PG_DATABASE: testDbName,
  };
  process.env.system_bucket = t.context.systemBucket;
  process.env.stackName = t.context.stackName;
  putJsonS3Object(
    t.context.systemBucket,
    getDistributionBucketMapKey(t.context.stackName),
    {
      [t.context.publicBucket]: t.context.publicBucket,
      [t.context.privateBucket]: t.context.privateBucket,
      [t.context.protectedBucket]: t.context.protectedBucket,
      [t.context.systemBucket]: t.context.systemBucket,
    }
  );
});

test.afterEach.always(async (t) => {
  await recursivelyDeleteS3Bucket(t.context.publicBucket);
  await recursivelyDeleteS3Bucket(t.context.protectedBucket);
  await recursivelyDeleteS3Bucket(t.context.systemBucket);
  await destroyLocalTestDb({
    knex: t.context.knex,
    knexAdmin: t.context.knexAdmin,
    tesetDbName: t.context.testDbName,
  });
});

test('Should move files to final location and update pg data', async (t) => {
  const payloadPath = path.join(__dirname, 'data', 'payload.json');
  const rawPayload = fs.readFileSync(payloadPath, 'utf8')
    .replaceAll('replaceme-public', t.context.bucketMapping.public)
    .replaceAll('replaceme-private', t.context.bucketMapping.private)
    .replaceAll('replaceme-protected', t.context.bucketMapping.protected);
  t.context.payload = JSON.parse(rawPayload);
  const filesToUpload = granulesToFileURIs(
    t.context.payload.input.granules
  );
  const collectionPath = path.join(__dirname, 'data', 'new_collection_base.json');
  const collection = JSON.parse(fs.readFileSync(collectionPath));
  const newPayload = buildPayload(t, collection);
  await uploadFiles(filesToUpload, t.context.bucketMapping);
  const pgRecords = await setupPGData(newPayload.input.granules, collection, t.context.knex);

  const output = await moveGranules(newPayload);
  await validateOutput(t, output);
  t.true(await s3ObjectExists({
    Bucket: t.context.protectedBucket,
    Key: 'example2/2003/MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
  }));
  t.true(await s3ObjectExists({
    Bucket: t.context.publicBucket,
    Key: 'jpg/example2/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
  }));
  t.true(await s3ObjectExists({
    Bucket: t.context.publicBucket,
    Key: 'example2/2003/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
  }));
  t.true(await s3ObjectExists({
    Bucket: t.context.publicBucket,
    Key: 'example2/2003/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml',
  }));
  const granuleModel = new GranulePgModel();
  const finalPgGranule = await granuleModel.get(t.context.knex, {
    cumulus_id: pgRecords.granules[0].cumulus_id,
  });
  t.true(finalPgGranule.granule_id === pgRecords.granules[0].granule_id);
  t.true(finalPgGranule.collection_cumulus_id === pgRecords.targetCollection.cumulus_id);
});

test('handles partially moved files', async (t) => {
  const payloadPath = path.join(__dirname, 'data', 'payload.json');
  const rawPayload = fs.readFileSync(payloadPath, 'utf8')
    .replaceAll('replaceme-public', t.context.publicBucket)
    .replaceAll('replaceme-private', t.context.privateBucket)
    .replaceAll('replaceme-protected', t.context.protectedBucket);
  t.context.payload = JSON.parse(rawPayload);

  // a starting granule state that disagrees with the payload as some have already been moved
  const startingState = [{
    files: [
      {
        key: 'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
        bucket: t.context.protectedBucket,
        type: 'data',
      },
      {
        key: 'jpg/example2/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
        bucket: t.context.publicBucket,
        type: 'browse',
      },
      {
        key: 'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
        bucket: t.context.publicBucket,
        type: 'browse',
      },
      {
        key: 'example2/2003/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml',
        bucket: t.context.publicBucket,
        type: 'metadata ',
      },
      {
        key: 'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml',
        bucket: t.context.protectedBucket,
        type: 'metadata',
      },
    ],
  }];
  const filesToUpload = granulesToFileURIs(
    startingState
  );
  const collectionPath = path.join(__dirname, 'data', 'new_collection_base.json');
  const collection = JSON.parse(fs.readFileSync(collectionPath));
  const newPayload = buildPayload(t, collection);

  const pgRecords = await setupPGData(newPayload.input.granules, collection, t.context.knex);
  await uploadFiles(filesToUpload, t.context.bucketMapping);

  const output = await moveGranules(newPayload);
  await validateOutput(t, output);
  t.true(await s3ObjectExists({
    Bucket: t.context.protectedBucket,
    Key: 'example2/2003/MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
  }));
  t.true(await s3ObjectExists({
    Bucket: t.context.publicBucket,
    Key: 'jpg/example2/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
  }));
  t.true(await s3ObjectExists({
    Bucket: t.context.publicBucket,
    Key: 'example2/2003/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
  }));
  t.true(await s3ObjectExists({
    Bucket: t.context.publicBucket,
    Key: 'example2/2003/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml',
  }));
  const granuleModel = new GranulePgModel();
  const finalPgGranule = await granuleModel.get(t.context.knex, {
    cumulus_id: pgRecords.granules[0].cumulus_id,
  });
  t.true(finalPgGranule.granule_id === pgRecords.granules[0].granule_id);
  t.true(finalPgGranule.collection_cumulus_id === pgRecords.targetCollection.cumulus_id);
});

test('handles files that are pre-moved and misplaced w/r to postgres', async (t) => {
  const payloadPath = path.join(__dirname, 'data', 'payload.json');
  const rawPayload = fs.readFileSync(payloadPath, 'utf8')
    .replaceAll('replaceme-public', t.context.bucketMapping.public)
    .replaceAll('replaceme-private', t.context.bucketMapping.private)
    .replaceAll('replaceme-protected', t.context.bucketMapping.protected);
  t.context.payload = JSON.parse(rawPayload);
  const startingState = [{
    files: [
      {
        key: 'example2/2003/MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
        bucket: t.context.protectedBucket,
        type: 'data',
      },
      {
        key: 'jpg/example2/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
        bucket: t.context.publicBucket,
        type: 'browse',
      },
      {
        key: 'example2/2003/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
        bucket: t.context.publicBucket,
        type: 'browse',
      },
      {
        key: 'example2/2003/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml',
        bucket: t.context.publicBucket,
        type: 'metadata ',
      },
      {
        key: 'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml',
        bucket: t.context.bucketMapping.protected,
        type: 'metadata',
      },
    ],
  }];
  const filesToUpload = granulesToFileURIs(
    startingState
  );
  const collectionPath = path.join(__dirname, 'data', 'new_collection_base.json');
  const collection = JSON.parse(fs.readFileSync(collectionPath));
  const newPayload = buildPayload(t, collection);

  await uploadFiles(filesToUpload, t.context.bucketMapping);
  const pgRecords = await setupPGData(newPayload.input.granules, collection, t.context.knex);
  const output = await moveGranules(newPayload);
  await validateOutput(t, output);
  t.true(await s3ObjectExists({
    Bucket: t.context.protectedBucket,
    Key: 'example2/2003/MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
  }));
  t.true(await s3ObjectExists({
    Bucket: t.context.publicBucket,
    Key: 'jpg/example2/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
  }));
  t.true(await s3ObjectExists({
    Bucket: t.context.publicBucket,
    Key: 'example2/2003/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
  }));
  t.true(await s3ObjectExists({
    Bucket: t.context.publicBucket,
    Key: 'example2/2003/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml',
  }));
  const granuleModel = new GranulePgModel();
  const finalPgGranule = await granuleModel.get(t.context.knex, {
    cumulus_id: pgRecords.granules[0].cumulus_id,
  });
  t.true(finalPgGranule.granule_id === pgRecords.granules[0].granule_id);
  t.true(finalPgGranule.collection_cumulus_id === pgRecords.targetCollection.cumulus_id);
});

test('handles files that need no move', async (t) => {
  const payloadPath = path.join(__dirname, 'data', 'payload.json');
  const rawPayload = fs.readFileSync(payloadPath, 'utf8')
    .replaceAll('replaceme-public', t.context.bucketMapping.public)
    .replaceAll('replaceme-private', t.context.bucketMapping.private)
    .replaceAll('replaceme-protected', t.context.bucketMapping.protected);
  t.context.payload = JSON.parse(rawPayload);
  const filesToUpload = granulesToFileURIs(
    t.context.payload.input.granules
  );
  const collectionPath = path.join(__dirname, 'data', 'no_move_collection.json');
  const collection = JSON.parse(fs.readFileSync(collectionPath));
  const newPayload = buildPayload(t, collection);
  await uploadFiles(filesToUpload, t.context.bucketMapping);
  const pgRecords = await setupPGData(newPayload.input.granules, collection, t.context.knex);

  const output = await moveGranules(newPayload);
  await validateOutput(t, output);
  t.true(await s3ObjectExists({
    Bucket: t.context.protectedBucket,
    Key: 'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
  }));
  t.true(await s3ObjectExists({
    Bucket: t.context.privateBucket,
    Key: 'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
  }));
  t.true(await s3ObjectExists({
    Bucket: t.context.publicBucket,
    Key: 'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
  }));
  t.true(await s3ObjectExists({
    Bucket: t.context.protectedBucket,
    Key: 'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml',
  }));

  const granuleModel = new GranulePgModel();
  const finalPgGranule = await granuleModel.get(t.context.knex, {
    cumulus_id: pgRecords.granules[0].cumulus_id,
  });
  t.true(finalPgGranule.granule_id === pgRecords.granules[0].granule_id);
  t.true(finalPgGranule.collection_cumulus_id === pgRecords.targetCollection.cumulus_id);
});
