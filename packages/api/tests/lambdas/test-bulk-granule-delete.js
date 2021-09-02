const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const {
  generateLocalTestDb,
  localStackConnectionEnv,
  GranulePgModel,
  migrationDir,
} = require('@cumulus/db');
const { createBucket, deleteS3Buckets } = require('@cumulus/aws-client/S3');
const { randomId } = require('@cumulus/common/test-utils');

const { bulkGranuleDelete } = require('../../lambdas/bulk-operation');
const Granule = require('../../models/granules');
const { createGranuleAndFiles } = require('../../lib/create-test-data');
const models = require('../../models');

const testDbName = `${cryptoRandomString({ length: 10 })}`;

const getGranuleCumulusId = (dynamoGranule, granules) => {
  const matchingGranule = granules.find(
    (granule) => granule.newDynamoGranule.granuleId === dynamoGranule.granuleId
  );
  return matchingGranule.newPgGranule;
};

test.before(async (t) => {
  process.env.GranulesTable = randomId('granule');
  process.env.CollectionsTable = randomId('collection');
  process.env.system_bucket = randomId('bucket');
  process.env = {
    ...process.env,
    ...localStackConnectionEnv,
    PG_DATABASE: testDbName,
  };

  // create a fake bucket
  await createBucket(process.env.system_bucket);

  await new models.Collection().createTable();
  await new Granule().createTable();

  const { knex, knexAdmin } = await generateLocalTestDb(testDbName, migrationDir);
  t.context.knex = knex;
  t.context.knexAdmin = knexAdmin;
});

test('bulkGranuleDelete does not fail on published granules if payload.forceRemoveFromCmr is true', async (t) => {
  const granuleModel = new Granule();
  const granulePgModel = new GranulePgModel();

  const granules = await Promise.all([
    createGranuleAndFiles({ dbClient: t.context.knex, published: true }),
    createGranuleAndFiles({ dbClient: t.context.knex, published: true }),
  ]);

  const dynamoGranuleId1 = granules[0].newDynamoGranule.granuleId;
  const dynamoGranuleId2 = granules[1].newDynamoGranule.granuleId;

  const { deletedGranules } = await bulkGranuleDelete(
    {
      ids: [
        dynamoGranuleId1,
        dynamoGranuleId2,
      ],
      forceRemoveFromCmr: true,
    },
    (_, dynamoGranule) => ({
      dynamoGranule: { granuleId: dynamoGranule.granuleId, published: false },
      pgGranule: {
        ...getGranuleCumulusId(dynamoGranule, granules),
        published: false,
      },
    })
  );

  t.deepEqual(
    deletedGranules.sort(),
    [
      dynamoGranuleId1,
      dynamoGranuleId2,
    ].sort()
  );

  // Granules should have been deleted from Dynamo
  t.false(await granuleModel.exists({ granuleId: dynamoGranuleId1 }));
  t.false(await granuleModel.exists({ granuleId: dynamoGranuleId2 }));

  // Granules should have been deleted from Postgres
  const pgCollectionCumulusId1 = granules[0].newPgGranule.collection_cumulus_id;
  const pgCollectionCumulusId2 = granules[1].newPgGranule.collection_cumulus_id;

  t.false(await granulePgModel.exists(
    t.context.knex,
    { granule_id: dynamoGranuleId1, collection_cumulus_id: pgCollectionCumulusId1 }
  ));
  t.false(await granulePgModel.exists(
    t.context.knex,
    { granule_id: dynamoGranuleId2, collection_cumulus_id: pgCollectionCumulusId2 }
  ));

  const s3Buckets = granules[0].s3Buckets;
  t.teardown(() => deleteS3Buckets([
    s3Buckets.protected.name,
    s3Buckets.public.name,
  ]));
});
