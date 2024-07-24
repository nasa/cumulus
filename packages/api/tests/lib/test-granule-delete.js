const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const { sns, sqs } = require('@cumulus/aws-client/services');
const {
  SubscribeCommand,
  DeleteTopicCommand,
} = require('@aws-sdk/client-sns');
const { createSnsTopic } = require('@cumulus/aws-client/SNS');
const {
  createBucket,
  deleteS3Buckets,
  s3ObjectExists,
} = require('@cumulus/aws-client/S3');
const { randomId, randomString } = require('@cumulus/common/test-utils');
const {
  CollectionPgModel,
  FilePgModel,
  generateLocalTestDb,
  destroyLocalTestDb,
  GranulePgModel,
  localStackConnectionEnv,
  migrationDir,
  fakeGranuleRecordFactory,
  translateApiCollectionToPostgresCollection,
} = require('@cumulus/db');
const { DeletePublishedGranule } = require('@cumulus/errors');
const { constructCollectionId } = require('@cumulus/message/Collections');

// Dynamo mock data factories
const {
  fakeCollectionFactory,
} = require('../../lib/testUtils');

const { deleteGranuleAndFiles } = require('../../src/lib/granule-delete');
const { createGranuleAndFiles } = require('../helpers/create-test-data');

const testDbName = `granules_${cryptoRandomString({ length: 10 })}`;

let filePgModel;
let granulePgModel;

process.env.stackName = randomId('stackname');
process.env.system_bucket = randomId('bucket');
process.env.TOKEN_SECRET = randomId('secret');

test.before(async (t) => {
  process.env = {
    ...process.env,
    ...localStackConnectionEnv,
    PG_DATABASE: testDbName,
  };

  // create a fake bucket
  await createBucket(process.env.system_bucket);

  granulePgModel = new GranulePgModel();
  filePgModel = new FilePgModel();

  const { knex, knexAdmin } = await generateLocalTestDb(testDbName, migrationDir);
  t.context.knex = knex;
  t.context.knexAdmin = knexAdmin;

  // Create a Dynamo collection
  // we need this because a granule has a fk referring to collections
  t.context.testCollection = fakeCollectionFactory({
    name: 'fakeCollection',
    version: 'v1',
    duplicateHandling: 'error',
  });
  t.context.collectionId = constructCollectionId(
    t.context.testCollection.name,
    t.context.testCollection.version
  );

  // Create a PostgreSQL Collection
  const collectionPgModel = new CollectionPgModel();
  const testPgCollection = translateApiCollectionToPostgresCollection(
    t.context.testCollection
  );
  const [pgCollection] = await collectionPgModel.create(
    t.context.knex,
    testPgCollection
  );
  t.context.collectionCumulusId = pgCollection.cumulus_id;
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

test.serial('deleteGranuleAndFiles() throws an error if the granule is published', async (t) => {
  const { newPgGranule, s3Buckets } = await createGranuleAndFiles({
    dbClient: t.context.knex,
    collectionId: t.context.collectionId,
    collectionCumulusId: t.context.collectionCumulusId,
    granuleParams: { published: true },
  });

  await t.throwsAsync(
    deleteGranuleAndFiles({
      knex: t.context.knex,
      pgGranule: newPgGranule,
    }),
    { instanceOf: DeletePublishedGranule }
  );

  // Check RDS. The granule should still exist.
  t.true(await granulePgModel.exists(
    t.context.knex,
    {
      granule_id: newPgGranule.granule_id,
      collection_cumulus_id: newPgGranule.collection_cumulus_id,
    }
  ));

  t.teardown(() => deleteS3Buckets([
    s3Buckets.protected.name,
    s3Buckets.public.name,
  ]));
});

test.serial('deleteGranuleAndFiles() removes granules from PostgreSQL and files from PostgreSQL/S3', async (t) => {
  const { collectionId, collectionCumulusId, knex } = t.context;

  const {
    apiGranule,
    newPgGranule,
    files,
    s3Buckets,
  } = await createGranuleAndFiles({
    dbClient: knex,
    collectionId,
    collectionCumulusId,
    granuleParams: { published: false },
  });

  t.true(await granulePgModel.exists(knex, {
    granule_id: newPgGranule.granule_id,
    collection_cumulus_id: collectionCumulusId,
  }));
  await Promise.all(
    files.map(async (file) => {
      t.true(await s3ObjectExists({ Bucket: file.bucket, Key: file.key }));
      t.true(await filePgModel.exists(knex, { bucket: file.bucket, key: file.key }));
    })
  );

  const details = await deleteGranuleAndFiles({
    knex: knex,
    pgGranule: newPgGranule,
  });

  t.truthy(details.deletionTime);
  t.like(details, {
    collection: t.context.collectionId,
    deletedGranuleId: apiGranule.granuleId,
  });
  t.is(details.deletedFiles.length, apiGranule.files.length);

  t.false(await granulePgModel.exists(
    knex,
    {
      granule_id: newPgGranule.granule_id,
      collection_cumulus_id: newPgGranule.collection_cumulus_id,
    }
  ));

  // Verify files were deleted from S3 and Postgres
  await Promise.all(
    files.map(async (file) => {
      t.false(await s3ObjectExists({ Bucket: file.bucket, Key: file.key }));
      t.false(await filePgModel.exists(knex, { bucket: file.bucket, key: file.key }));
    })
  );

  t.teardown(() => deleteS3Buckets([
    s3Buckets.protected.name,
    s3Buckets.public.name,
  ]));
});

test.serial('deleteGranuleAndFiles() succeeds if a file is not present in S3', async (t) => {
  const granuleId = randomId('granule');
  // create Postgres granule
  const fakePGGranule = fakeGranuleRecordFactory(
    {
      granule_id: granuleId,
      status: 'failed',
      collection_cumulus_id: t.context.collectionCumulusId,
    }
  );
  fakePGGranule.published = false;
  const [pgGranule] = await granulePgModel.create(t.context.knex, fakePGGranule);

  const file = {
    granule_cumulus_id: pgGranule.cumulus_id,
    bucket: process.env.system_bucket,
    file_name: `${granuleId}.hdf`,
    key: randomString(),
  };
  await filePgModel.create(t.context.knex, file);
  const newPgGranule = await granulePgModel.get(t.context.knex, {
    cumulus_id: pgGranule.cumulus_id,
  });

  const details = await deleteGranuleAndFiles({
    knex: t.context.knex,
    pgGranule: newPgGranule,
  });

  t.truthy(details.deletionTime);
  t.like(details, {
    collection: t.context.collectionId,
    deletedGranuleId: newPgGranule.granule_id,
  });
  t.is(details.deletedFiles.length, 1);

  t.false(await granulePgModel.exists(
    t.context.knex,
    {
      granule_id: newPgGranule.granule_id,
      collection_cumulus_id: newPgGranule.collection_cumulus_id,
    }
  ));
});

test.serial('deleteGranuleAndFiles() will not delete S3 Files if the PostgreSQL granule delete fails', async (t) => {
  const {
    newPgGranule,
    files,
    s3Buckets,
  } = await createGranuleAndFiles({
    dbClient: t.context.knex,
    collectionId: t.context.collectionId,
    collectionCumulusId: t.context.collectionCumulusId,
    granuleParams: { published: false },
  });

  const mockGranuleModel = {
    tableName: 'granules',
    delete: () => {
      throw new Error('PG delete failed');
    },
  };

  await t.throwsAsync(
    deleteGranuleAndFiles({
      knex: t.context.knex,
      pgGranule: newPgGranule,
      granulePgModel: mockGranuleModel,
    }),
    { message: 'PG delete failed' }
  );

  // granule should still exist in PostgreSQL
  t.true(await granulePgModel.exists(
    t.context.knex,
    {
      granule_id: newPgGranule.granule_id,
      collection_cumulus_id: newPgGranule.collection_cumulus_id,
    }
  ));

  // Files will still exist in S3 and PostgreSQL.
  await Promise.all(
    files.map(async (file) => {
      t.true(await s3ObjectExists({ Bucket: file.bucket, Key: file.key }));
      t.true(await filePgModel.exists(t.context.knex, { bucket: file.bucket, key: file.key }));
    })
  );

  t.teardown(() => deleteS3Buckets([
    s3Buckets.protected.name,
    s3Buckets.public.name,
  ]));
});
