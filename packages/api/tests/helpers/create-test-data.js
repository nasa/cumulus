'use strict';

const fs = require('fs-extra');
const path = require('path');

const {
  randomId,
  randomString,
  randomStringFromRegex,
} = require('@cumulus/common/test-utils');
const { s3PutObject } = require('@cumulus/aws-client/S3');
const {
  FilePgModel,
  GranulePgModel,
  CollectionPgModel,
  translateApiGranuleToPostgresGranule,
  translatePostgresGranuleToApiGranule,
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

const metadataFileFixture = fs.readFileSync(path.resolve(__dirname, '../data/meta.xml'), 'utf-8');

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
  collectionCumulusId,
  collectionId,
  dbClient,
  esClient,
  executionPgRecord,
  granulesExecutionsPgModel,
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
      size: 50,
    },
    {
      bucket: s3Buckets.public.name,
      fileName: `${granuleId}.jpg`,
      key: `${randomString(5)}/${granuleId}.jpg`,
      size: 50,
    },
  ];

  // Add files to S3
  await Promise.all(files.map((file) => s3PutObject({
    Bucket: file.bucket,
    Key: file.key,
    Body: `test data ${randomString()}`,
  })));

  const metadataFile = {
    bucket: s3Buckets.protected.name,
    fileName: `${granuleId}.cmr.xml`,
    key: `${randomString(5)}/${granuleId}.cmr.xml`,
    size: 7956,
  };
  await s3PutObject({
    Bucket: metadataFile.bucket,
    Key: metadataFile.key,
    Body: metadataFileFixture,
  });
  files.push(metadataFile);

  const newGranule = fakeGranuleFactoryV2(
    {
      granuleId: granuleId,
      status: 'failed',
      collectionId: granuleCollectionId,
      ...granuleParams,
      files,
    }
  );

  // create a new Postgres granule
  const newPgGranule = await translateApiGranuleToPostgresGranule({
    dynamoRecord: newGranule,
    knexOrTransaction: dbClient,
  });
  const [pgGranule] = await granulePgModel.create(dbClient, newPgGranule);

  // create Postgres files
  await Promise.all(
    files.map((f) => {
      const pgFile = {
        bucket: f.bucket,
        file_name: f.fileName,
        granule_cumulus_id: pgGranule.cumulus_id,
        key: f.key,
        file_size: f.size,
      };

      return filePgModel.create(dbClient, pgFile);
    })
  );

  if (executionPgRecord && granulesExecutionsPgModel) {
    await granulesExecutionsPgModel.create(dbClient, {
      granule_cumulus_id: pgGranule.cumulus_id,
      execution_cumulus_id: executionPgRecord.cumulus_id,
    });
  }

  const apiGranule = await translatePostgresGranuleToApiGranule({
    knexOrTransaction: dbClient,
    granulePgRecord: pgGranule,
  });

  await indexGranule(esClient, apiGranule, process.env.ES_INDEX);

  const esGranulesClient = new Search(
    {},
    'granule',
    process.env.ES_INDEX
  );

  return {
    newPgGranule: await granulePgModel.get(dbClient, { cumulus_id: pgGranule.cumulus_id }),
    apiGranule,
    esRecord: await esGranulesClient.get(newGranule.granuleId),
    files: files,
    s3Buckets: s3Buckets,
  };
}

/**
 * Helper for creating array of granule IDs of variable length
 *
 * @param {number} count - defaults to 5000
 * @returns {Array<string>} returns array of granule IDs
 */
const generateListOfGranules = (count = 5000) => {
  const granuleRegString = () => randomStringFromRegex('^MOD09GQ\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$');
  const granuleLongString = () => randomStringFromRegex('^SWOT_L2_HR_Raster_\\_[\\w]{6}\\_[\\w]{1}\\_[\\d]{20}\\_[\\w]{6}\\_[\\d]{13}$');
  const collectionId = () => `${randomString(3)}__${randomString(5)}`;
  const granules = [];
  const halfOfCount = count / 2;
  for (let i = 0; i < halfOfCount; i += 1) {
    granules.push({ granuleId: granuleRegString(), collectionId: collectionId() });
    granules.push({ granuleId: granuleLongString(), collectionId: collectionId() });
  }
  return granules;
};

module.exports = {
  createGranuleAndFiles,
  generateListOfGranules,
};
