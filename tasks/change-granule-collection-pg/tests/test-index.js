'use strict';

const fs = require('fs');

const proxyquire = require('proxyquire');
const path = require('path');
const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const { s3 } = require('@cumulus/aws-client/services');
const {
  recursivelyDeleteS3Bucket,
  putJsonS3Object,
  s3PutObject,
  s3ObjectExists,
} = require('@cumulus/aws-client/S3');
const {
  randomId, validateOutput,
  randomString,
} = require('@cumulus/common/test-utils');
const { getDistributionBucketMapKey } = require('@cumulus/distribution-utils');
const { bulkPatchGranuleCollection, bulkPatch } = require('@cumulus/api/endpoints/granules');
const { createTestIndex, cleanupTestIndex } = require('@cumulus/es-client/testUtils');
const indexer = require('@cumulus/es-client/indexer');

const sinon = require('sinon');
const { createSnsTopic } = require('@cumulus/aws-client/SNS');
const {
  generateLocalTestDb,
  migrationDir,
  GranulePgModel,
  CollectionPgModel,
  translateApiCollectionToPostgresCollection,
  translateApiGranuleToPostgresGranule,
  localStackConnectionEnv,
} = require('@cumulus/db');
const range = require('lodash/range');
const { constructCollectionId } = require('../../../packages/message/Collections');

const mockResponse = () => {
  const res = {};
  res.status = sinon.stub().returns(res);
  res.send = sinon.stub().returns(res);
  return res;
};

let changeGranuleCollectionsPG;

function getOriginalCollection() {
  return JSON.parse(fs.readFileSync(
    path.join(
      __dirname,
      'data',
      'original_collection.json'
    )
  ));
}

async function setupS3Data(granules) {
  await Promise.all(granules.map((granule) => Promise.all(
    granule.files.map((file) => s3PutObject({
      Bucket: file.bucket,
      Key: file.key,
      Body: 'abc',
    }))
  )));
}

async function setupDataStoreData(granules, targetCollection, t) {
  const {
    knex,
    esClient,
    esIndex,
  } = t.context;
  const granuleModel = new GranulePgModel();
  const collectionModel = new CollectionPgModel();
  const sourceCollection = getOriginalCollection();
  const pgRecords = {};
  await collectionModel.create(
    knex,
    translateApiCollectionToPostgresCollection(sourceCollection)
  );
  await indexer.indexCollection(
    esClient,
    sourceCollection,
    esIndex
  );
  [pgRecords.targetCollection] = await collectionModel.create(
    knex,
    translateApiCollectionToPostgresCollection(targetCollection)
  );
  await indexer.indexCollection(
    esClient,
    targetCollection,
    esIndex
  );
  pgRecords.granules = await granuleModel.insert(
    knex,
    await Promise.all(granules.map(async (granule) => (
      await translateApiGranuleToPostgresGranule({
        dynamoRecord: granule,
        knexOrTransaction: knex,
      })
    ))),
    ['cumulus_id', 'granule_id']
  );

  await Promise.all(granules.map((granule) => indexer.indexGranule(
    esClient,
    granule,
    esIndex
  )));
  return pgRecords;
}

function buildPayload(t, collection) {
  const newPayload = t.context.payload;
  newPayload.config.targetCollection = collection;
  newPayload.config.collection = getOriginalCollection();
  newPayload.config.buckets.internal.name = t.context.stagingBucket;
  newPayload.config.buckets.public.name = t.context.publicBucket;
  newPayload.config.buckets.private.name = t.context.privateBucket;
  newPayload.config.buckets.protected.name = t.context.protectedBucket;
  return newPayload;
}

test.beforeEach(async (t) => {
  const topicName = randomString();
  const { TopicArn } = await createSnsTopic(topicName);
  process.env.granule_sns_topic_arn = TopicArn;
  const testDbName = `cumulus`;
  changeGranuleCollectionsPG = proxyquire(
    '../dist/src',
    {
      '@cumulus/api-client/granules': {
        bulkPatchGranuleCollection: (params) => (
          bulkPatchGranuleCollection(params, mockResponse())
        ),
        bulkPatch: (params) => (
          bulkPatch(params, mockResponse())
        ),
      },
    }
  ).changeGranuleCollectionsPG;
  const { knexAdmin, knex } = await generateLocalTestDb(
    testDbName,
    migrationDir
  );
  const { esIndex, esClient } = await createTestIndex();
  t.context.esIndex = esIndex;
  t.context.esClient = esClient;

  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;
  t.context.publicBucket = randomId('public');
  t.context.protectedBucket = randomId('protected');
  t.context.privateBucket = randomId('private');
  t.context.systemBucket = randomId('system');
  t.context.stackName = randomId('changeGranuleCollectionsPGTestStack');
  const bucketMapping = {
    public: t.context.publicBucket,
    protected: t.context.protectedBucket,
    private: t.context.privateBucket,
    system: t.context.systemBucket,
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
    system_bucket: t.context.systemBucket,
    stackName: t.context.stackName,
  };
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
  await recursivelyDeleteS3Bucket(t.context.protectedBucket);
  await recursivelyDeleteS3Bucket(t.context.publicBucket);
  await recursivelyDeleteS3Bucket(t.context.privateBucket);
  await recursivelyDeleteS3Bucket(t.context.systemBucket);
  await cleanupTestIndex(t.context);
});

test.serial('changeGranuleCollectionsPG Should update pg status and cleanup in s3', async (t) => {
  const payloadPath = path.join(__dirname, 'data', 'payload_base.json');
  let payloadString = fs.readFileSync(payloadPath, 'utf8');
  payloadString = payloadString.replaceAll('replaceme-publicBucket', t.context.publicBucket);
  payloadString = payloadString.replaceAll('replaceme-privateBucket', t.context.privateBucket);
  payloadString = payloadString.replaceAll('replaceme-protectedBucket', t.context.protectedBucket);
  t.context.payload = JSON.parse(payloadString);
  await setupS3Data(t.context.payload.input.granules);
  await setupS3Data(t.context.payload.config.oldGranules);
  const collectionPath = path.join(__dirname, 'data', 'new_collection.json');
  const collection = JSON.parse(fs.readFileSync(collectionPath));
  const newPayload = buildPayload(t, collection);
  const pgRecords = await setupDataStoreData(
    newPayload.config.oldGranules,
    collection,
    t
  );
  const output = await changeGranuleCollectionsPG(newPayload);
  await validateOutput(t, output);
  const granuleModel = new GranulePgModel();
  const finalPgGranule = await granuleModel.get(t.context.knex, {
    cumulus_id: pgRecords.granules[0].cumulus_id,
  });
  t.assert(finalPgGranule.granule_id === pgRecords.granules[0].granule_id);
  t.assert(finalPgGranule.collection_cumulus_id === pgRecords.targetCollection.cumulus_id);
  //ensure old files have been cleaned up

  await Promise.all(newPayload.config.oldGranules.map((granule) => Promise.all(
    granule.files.map(async (file) => {
      t.assert(!await s3ObjectExists({
        Bucket: file.bucket,
        Key: file.key,
      }));
    })
  )));
  await Promise.all(newPayload.input.granules.map((granule) => Promise.all(
    granule.files.map(async (file) => {
      t.assert(await s3ObjectExists({
        Bucket: file.bucket,
        Key: file.key,
      }));
    })
  )));
});

test.serial('changeGranuleCollectionsPG should handle change where only some files are being moved', async (t) => {
  const payloadPath = path.join(__dirname, 'data', 'payload_base.json');
  let payloadString = fs.readFileSync(payloadPath, 'utf8');
  payloadString = payloadString.replaceAll('replaceme-publicBucket', t.context.publicBucket);
  payloadString = payloadString.replaceAll('replaceme-privateBucket', t.context.privateBucket);
  payloadString = payloadString.replaceAll('replaceme-protectedBucket', t.context.protectedBucket);
  t.context.payload = JSON.parse(payloadString);

  t.context.payload.config.oldGranules[0].files[0] = t.context.payload.input.granules[0].files[0];
  t.context.payload.config.oldGranules[0].files[1] = t.context.payload.input.granules[0].files[1];

  await setupS3Data(t.context.payload.input.granules);
  await setupS3Data(t.context.payload.config.oldGranules);
  const collectionPath = path.join(__dirname, 'data', 'new_collection.json');
  const collection = JSON.parse(fs.readFileSync(collectionPath));
  const newPayload = buildPayload(t, collection);
  const pgRecords = await setupDataStoreData(
    newPayload.config.oldGranules,
    collection,
    t
  );
  const output = await changeGranuleCollectionsPG(newPayload);
  await validateOutput(t, output);
  const granuleModel = new GranulePgModel();
  const finalPgGranule = await granuleModel.get(t.context.knex, {
    cumulus_id: pgRecords.granules[0].cumulus_id,
  });
  t.assert(finalPgGranule.granule_id === pgRecords.granules[0].granule_id);
  t.assert(finalPgGranule.collection_cumulus_id === pgRecords.targetCollection.cumulus_id);
  //ensure old files have been cleaned up

  await Promise.all(newPayload.config.oldGranules.slice(2).map((granule) => Promise.all(
    granule.files.map(async (file) => {
      t.assert(!await s3ObjectExists({
        Bucket: file.bucket,
        Key: file.key,
      }));
    })
  )));
  await Promise.all(newPayload.input.granules.map((granule) => Promise.all(
    granule.files.map(async (file) => {
      t.assert(await s3ObjectExists({
        Bucket: file.bucket,
        Key: file.key,
      }));
    })
  )));
});

test.serial('changeGranuleCollectionsPG should handle change where no files are being moved', async (t) => {
  const payloadPath = path.join(__dirname, 'data', 'payload_base.json');
  let payloadString = fs.readFileSync(payloadPath, 'utf8');
  payloadString = payloadString.replaceAll('replaceme-publicBucket', t.context.publicBucket);
  payloadString = payloadString.replaceAll('replaceme-privateBucket', t.context.privateBucket);
  payloadString = payloadString.replaceAll('replaceme-protectedBucket', t.context.protectedBucket);
  t.context.payload = JSON.parse(payloadString);

  t.context.payload.config.oldGranules[0].files = t.context.payload.input.granules[0].files;
  await setupS3Data(t.context.payload.input.granules);
  await setupS3Data(t.context.payload.config.oldGranules);
  const collectionPath = path.join(__dirname, 'data', 'new_collection.json');
  const collection = JSON.parse(fs.readFileSync(collectionPath));
  const newPayload = buildPayload(t, collection);
  const pgRecords = await setupDataStoreData(
    newPayload.config.oldGranules,
    collection,
    t
  );
  const output = await changeGranuleCollectionsPG(newPayload);
  await validateOutput(t, output);
  const granuleModel = new GranulePgModel();
  const finalPgGranule = await granuleModel.get(t.context.knex, {
    cumulus_id: pgRecords.granules[0].cumulus_id,
  });
  t.assert(finalPgGranule.granule_id === pgRecords.granules[0].granule_id);
  t.assert(finalPgGranule.collection_cumulus_id === pgRecords.targetCollection.cumulus_id);
  //nothing should have been cleaned up

  await Promise.all(newPayload.input.granules.map((granule) => Promise.all(
    granule.files.map(async (file) => {
      t.assert(await s3ObjectExists({
        Bucket: file.bucket,
        Key: file.key,
      }));
    })
  )));
});

test.serial('changeGranuleCollectionsPG Should work correctly for a large batch', async (t) => {
  const payloadPath = path.join(__dirname, 'data', 'payload_base.json');
  let payloadString = fs.readFileSync(payloadPath, 'utf8');
  payloadString = payloadString.replaceAll('replaceme-publicBucket', t.context.publicBucket);
  payloadString = payloadString.replaceAll('replaceme-privateBucket', t.context.privateBucket);
  payloadString = payloadString.replaceAll('replaceme-protectedBucket', t.context.protectedBucket);
  t.context.payload = JSON.parse(payloadString);

  const collectionPath = path.join(__dirname, 'data', 'new_collection.json');
  const collection = JSON.parse(fs.readFileSync(collectionPath));
  const newPayload = buildPayload(t, collection);

  const bucketNames = Object.values(
    newPayload.config.buckets
  ).map((bucket) => bucket.name).filter(Boolean);
  const oldGranules = range(200).map((_) => ({
    granuleId: cryptoRandomString({ length: 5 }),
    status: 'completed',
    collectionId: constructCollectionId(
      t.context.payload.config.collection.name,
      t.context.payload.config.collection.version
    ),
    files: range(5).map((__) => ({
      key: `${cryptoRandomString({ length: 12 })}`,
      bucket: bucketNames[Math.floor(bucketNames.length * Math.random())],
    })),
  }));
  const newGranules = oldGranules.map((oldGranule) => ({
    ...oldGranule,
    collectionId: constructCollectionId(
      t.context.payload.config.targetCollection.name,
      t.context.payload.config.targetCollection.version
    ),
    files: oldGranule.files.map((oldFile) => ({
      ...oldFile,
      bucket: bucketNames[Math.floor(bucketNames.length * Math.random())],
      key: `anotherPrefixprefix/${oldFile.key}`,
    })),
  }));

  newPayload.input.granules = newGranules;
  newPayload.config.oldGranules = oldGranules;
  await setupS3Data(t.context.payload.input.granules);
  await setupS3Data(t.context.payload.config.oldGranules);
  const pgRecords = await setupDataStoreData(
    newPayload.config.oldGranules,
    collection,
    t
  );
  const output = await changeGranuleCollectionsPG(newPayload);
  await validateOutput(t, output);
  const granuleModel = new GranulePgModel();
  const finalPgGranule = await granuleModel.get(t.context.knex, {
    cumulus_id: pgRecords.granules[0].cumulus_id,
  });
  t.assert(finalPgGranule.granule_id === pgRecords.granules[0].granule_id);
  t.assert(finalPgGranule.collection_cumulus_id === pgRecords.targetCollection.cumulus_id);
  //ensure old files have been cleaned up

  await Promise.all(newPayload.config.oldGranules.map((granule) => Promise.all(
    granule.files.map(async (file) => {
      t.assert(!await s3ObjectExists({
        Bucket: file.bucket,
        Key: file.key,
      }));
    })
  )));
  await Promise.all(newPayload.input.granules.map((granule) => Promise.all(
    granule.files.map(async (file) => {
      t.assert(await s3ObjectExists({
        Bucket: file.bucket,
        Key: file.key,
      }));
    })
  )));
});
