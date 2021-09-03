'use strict';

const { randomString, randomId } = require('@cumulus/common/test-utils');
const { s3PutObject } = require('@cumulus/aws-client/S3');
const {
  FilePgModel,
  GranulePgModel,
  CollectionPgModel,
  translateApiGranuleToPostgresGranule,
} = require('@cumulus/db');
const { indexGranule } = require('@cumulus/es-client/indexer');
const { Search } = require('@cumulus/es-client/search');
const { constructCollectionId } = require('@cumulus/message/Collections');

// Postgres mock data factories
const {
  fakeCollectionRecordFactory,
} = require('@cumulus/db/dist/test-utils');

const {
  createS3Buckets,
} = require('@cumulus/aws-client/S3');

// Dynamo mock data factories
const {
  fakeGranuleFactoryV2,
} = require('../../lib/testUtils');

const models = require('../../models');

/**
 * Helper for creating a granule, a parent collection,
 * and files belonging to that granule (in S3 and Postgres)
 *
 * @param {Object} params
 * @param {Knex} params.dbClient - Knex client
 * @param {number} params.collectionId - collectionId for the granule's parent collection
 * @param {number} params.collectionCumulusId - cumulus_id for the granule's parent collection
 * @param {boolean} params.published - if the granule should be marked published to CMR
 * @returns {Object} fake granule object
 */
async function createGranuleAndFiles({
  dbClient,
  collectionId,
  collectionCumulusId,
  esClient,
  granuleParams = { published: false },
}) {
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

  await createS3Buckets([
    s3Buckets.protected.name,
    s3Buckets.public.name,
  ]);

  const granuleModel = new models.Granule();
  const granulePgModel = new GranulePgModel();
  const filePgModel = new FilePgModel();

  const granuleId = randomId('granule');

  const collectionName = randomString(5);
  const collectionVersion = randomString(3);
  const newCollectionId = constructCollectionId(
    collectionName,
    collectionVersion
  );

  // If a cumulus_id for a Collection was not passed,
  // create one to use for the Granule creation
  if (!collectionCumulusId) {
    const testPgCollection = fakeCollectionRecordFactory({
      name: collectionName,
      version: collectionVersion,
    });

    const collectionPgModel = new CollectionPgModel();
    await collectionPgModel.create(
      dbClient,
      testPgCollection
    );
  }

  const granuleCollectionId = collectionId || newCollectionId;

  const files = [
    {
      bucket: s3Buckets.protected.name, // TODO making some assumptions
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
      collectionId: granuleCollectionId,
      ...granuleParams,
    }
  );

  newGranule.files = files;

  // Add files to S3
  await Promise.all(newGranule.files.map((file) => s3PutObject({
    Bucket: file.bucket,
    Key: file.key,
    Body: `test data ${randomString()}`,
  })));

  // create a new Dynamo granule
  const dynamoGranule = await granuleModel.create(newGranule);
  await indexGranule(esClient, dynamoGranule, process.env.ES_INDEX);

  // create a new Postgres granule
  const newPgGranule = await translateApiGranuleToPostgresGranule(dynamoGranule, dbClient);
  const [granuleCumulusId] = await granulePgModel.create(dbClient, newPgGranule);

  // create Postgres files
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

  const esGranulesClient = new Search(
    {},
    'granule',
    process.env.ES_INDEX
  );

  return {
    newPgGranule: await granulePgModel.get(dbClient, { cumulus_id: granuleCumulusId }),
    newDynamoGranule: await granuleModel.get({ granuleId: newGranule.granuleId }),
    esRecord: await esGranulesClient.get(newGranule.granuleId),
    files: files,
    s3Buckets: s3Buckets,
  };
}

module.exports = {
  createGranuleAndFiles,
};
