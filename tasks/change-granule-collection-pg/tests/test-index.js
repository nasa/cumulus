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
const { generateLocalTestDb, migrationDir, GranulePgModel, CollectionPgModel, translateApiCollectionToPostgresCollection, translateApiGranuleToPostgresGranule, localStackConnectionEnv } = require('@cumulus/db');

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
    await Promise.all(granules.map(async (g) => (
      await translateApiGranuleToPostgresGranule({ dynamoRecord: g, knexOrTransaction: knex })
    ))),
    ['cumulus_id', 'granule_id']
  );

  await Promise.all(granules.map((g) => indexer.indexGranule(
    esClient,
    g,
    esIndex
  )));
  return pgRecords;
}

function buildPayload(t, collection) {
  const newPayload = t.context.payload;
  newPayload.config.targetCollection = collection;
  newPayload.config.collection = getOriginalCollection();
  newPayload.config.bucket = t.context.stagingBucket;
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
  const testDbName = `change-granule-collection-pg/change-collections-s3${cryptoRandomString({ length: 10 })}`;
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
  t.context.stackName = 'changeGranuleCollectionsPGTestStack';
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
  await recursivelyDeleteS3Bucket(t.context.systemBucket);
  await cleanupTestIndex(t.context);
});

test.serial('Should move files to final and pg status', async (t) => {
  const payloadPath = path.join(__dirname, 'data', 'payload_base.json');
  let payloadString = fs.readFileSync(payloadPath, 'utf8');
  payloadString = payloadString.replaceAll('replaceme-publicBucket', t.context.publicBucket);
  payloadString = payloadString.replaceAll('replaceme-privateBucket', t.context.privateBucket);
  payloadString = payloadString.replaceAll('replaceme-protectedBucket', t.context.protectedBucket);
  t.context.payload = JSON.parse(payloadString);
  const collectionPath = path.join(__dirname, 'data', 'new_collection_ummg_cmr.json');
  const collection = JSON.parse(fs.readFileSync(collectionPath));
  const newPayload = buildPayload(t, collection);
  const pgRecords = await setupDataStoreData(
    newPayload.input.granules,
    collection,
    t
  );
  const output = await changeGranuleCollectionsPG(newPayload);
  await validateOutput(t, output);
  const granuleModel = new GranulePgModel();
  const finalPgGranule = await granuleModel.get(t.context.knex, {
    cumulus_id: pgRecords.granules[0].cumulus_id,
  });
  t.true(finalPgGranule.granule_id === pgRecords.granules[0].granule_id);
  t.true(finalPgGranule.collection_cumulus_id === pgRecords.targetCollection.cumulus_id);
});

test.serial('Should move files to final and pg status when granules have already been partly moved', async (t) => {
  const payloadPath = path.join(__dirname, 'data', 'payload_partly_moved.json');
  let payloadString = fs.readFileSync(payloadPath, 'utf8');
  payloadString = payloadString.replaceAll('replaceme-publicBucket', t.context.publicBucket);
  payloadString = payloadString.replaceAll('replaceme-privateBucket', t.context.privateBucket);
  payloadString = payloadString.replaceAll('replaceme-protectedBucket', t.context.protectedBucket);
  t.context.payload = JSON.parse(payloadString);
  const collectionPath = path.join(__dirname, 'data', 'new_collection_ummg_cmr.json');
  const collection = JSON.parse(fs.readFileSync(collectionPath));
  const newPayload = buildPayload(t, collection);
  const pgRecords = await setupDataStoreData(
    newPayload.input.granules,
    collection,
    t
  );
  const output = await changeGranuleCollectionsPG(newPayload);
  await validateOutput(t, output);
  const granuleModel = new GranulePgModel();
  const finalPgGranule = await granuleModel.get(t.context.knex, {
    cumulus_id: pgRecords.granules[0].cumulus_id,
  });
  t.true(finalPgGranule.granule_id === pgRecords.granules[0].granule_id);
  t.true(finalPgGranule.collection_cumulus_id === pgRecords.targetCollection.cumulus_id);
});

test.serial('handles files that need no move', async (t) => {
  const payloadPath = path.join(__dirname, 'data', 'payload_base.json');

  t.context.payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
  const collectionPath = path.join(__dirname, 'data', 'no_move_collection.json');
  const collection = JSON.parse(fs.readFileSync(collectionPath));
  const newPayload = buildPayload(t, collection);
  const pgRecords = await setupDataStoreData(
    newPayload.input.granules,
    collection,
    t
  );

  const output = await changeGranuleCollectionsPG(newPayload);
  await validateOutput(t, output);

  const granuleModel = new GranulePgModel();
  const finalPgGranule = await granuleModel.get(t.context.knex, {
    cumulus_id: pgRecords.granules[0].cumulus_id,
  });
  t.true(finalPgGranule.granule_id === pgRecords.granules[0].granule_id);
  t.true(finalPgGranule.collection_cumulus_id === pgRecords.targetCollection.cumulus_id);
});
