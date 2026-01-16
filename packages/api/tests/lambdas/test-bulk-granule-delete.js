const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const {
  generateLocalTestDb,
  localStackConnectionEnv,
  GranulePgModel,
  migrationDir,
  destroyLocalTestDb,
  CollectionPgModel,
  fakeCollectionRecordFactory,
} = require('@cumulus/db');
const { createBucket, deleteS3Buckets } = require('@cumulus/aws-client/S3');
const { randomId, randomString } = require('@cumulus/common/test-utils');

const { sns, sqs } = require('@cumulus/aws-client/services');
const {
  SubscribeCommand,
  DeleteTopicCommand,
} = require('@aws-sdk/client-sns');
const { createSnsTopic } = require('@cumulus/aws-client/SNS');

const { bulkGranuleDelete } = require('../../lambdas/bulk-operation');
const { createGranuleAndFiles } = require('../helpers/create-test-data');

const testDbName = `${cryptoRandomString({ length: 10 })}`;

test.before(async (t) => {
  process.env.system_bucket = randomId('bucket');
  process.env = {
    ...process.env,
    ...localStackConnectionEnv,
    PG_DATABASE: testDbName,
  };

  // create a fake bucket
  await createBucket(process.env.system_bucket);

  const { knex, knexAdmin } = await generateLocalTestDb(testDbName, migrationDir);
  t.context.knex = knex;
  t.context.knexAdmin = knexAdmin;
});

test.beforeEach(async (t) => {
  const topicName = randomString();
  const { TopicArn } = await createSnsTopic(topicName);
  process.env.granule_sns_topic_arn = TopicArn;
  t.context.TopicArn = TopicArn;

  const QueueName = randomString();
  const { QueueUrl } = await sqs().createQueue({ QueueName });
  t.context.QueueUrl = QueueUrl;
  const getQueueAttributesResponse = await sqs().getQueueAttributes({
    QueueUrl,
    AttributeNames: ['QueueArn'],
  });
  const QueueArn = getQueueAttributesResponse.Attributes.QueueArn;

  const { SubscriptionArn } = await sns().send(new SubscribeCommand({
    TopicArn,
    Protocol: 'sqs',
    Endpoint: QueueArn,
  }));

  t.context.SubscriptionArn = SubscriptionArn;
});

test.afterEach(async (t) => {
  const { QueueUrl, TopicArn } = t.context;
  await sqs().deleteQueue({ QueueUrl });
  await sns().send(new DeleteTopicCommand({ TopicArn }));
});

test.after.always(async (t) => {
  await destroyLocalTestDb({
    knex: t.context.knex,
    knexAdmin: t.context.knexAdmin,
    testDbName,
  });
});

test('bulkGranuleDelete does not fail on published granules if payload.forceRemoveFromCmr is true', async (t) => {
  const {
    knex,
  } = t.context;

  const granulePgModel = new GranulePgModel();
  const collectionPgModel = new CollectionPgModel();
  const collection = fakeCollectionRecordFactory();
  const [collectionPgRecord] = await collectionPgModel.create(
    t.context.knex,
    collection
  );

  const granules = await Promise.all([
    createGranuleAndFiles({
      dbClient: knex,
      granuleParams: {
        published: true,
        collection_cumulus_id: collectionPgRecord.cumulus_id,
      },
      writeDynamo: false,
    }),
    createGranuleAndFiles({
      dbClient: knex,
      granuleParams: {
        published: true,
        collection_cumulus_id: collectionPgRecord.cumulus_id,
      },
      writeDynamo: false,
    }),
  ]);

  const pgGranule1 = granules[0].newPgGranule;
  const pgGranule2 = granules[1].newPgGranule;
  const pgGranuleId1 = pgGranule1.granule_id;
  const pgGranuleId2 = pgGranule2.granule_id;

  const removeGranuleFromCmrFunctionMock = () => true;

  const granuleIds = [pgGranuleId1, pgGranuleId2];

  const results = await bulkGranuleDelete(
    {
      granules: granuleIds,
      forceRemoveFromCmr: true,
    },
    removeGranuleFromCmrFunctionMock
  );

  t.deepEqual(
    results.sort(),
    granuleIds.sort()
  );
  // Granules should have been deleted from Postgres
  const pgCollectionCumulusId1 = granules[0].newPgGranule.collection_cumulus_id;
  const pgCollectionCumulusId2 = granules[1].newPgGranule.collection_cumulus_id;

  t.false(await granulePgModel.exists(
    t.context.knex,
    { granule_id: pgGranuleId1, collection_cumulus_id: pgCollectionCumulusId1 }
  ));
  t.false(await granulePgModel.exists(
    t.context.knex,
    { granule_id: pgGranuleId2, collection_cumulus_id: pgCollectionCumulusId2 }
  ));

  const s3Buckets = granules[0].s3Buckets;
  t.teardown(() => deleteS3Buckets([
    s3Buckets.protected.name,
    s3Buckets.public.name,
  ]));
});
