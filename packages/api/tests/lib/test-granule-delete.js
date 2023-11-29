const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const {
  sns,
  sqs,
} = require('@cumulus/aws-client/services');

const { recordNotFoundString } = require('@cumulus/es-client/search');

const {
  createBucket,
  deleteS3Buckets,
  s3ObjectExists,
  s3PutObject,
  createS3Buckets,
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
const { Search } = require('@cumulus/es-client/search');
const {
  createTestIndex,
  cleanupTestIndex,
} = require('@cumulus/es-client/testUtils');
const { constructCollectionId } = require('@cumulus/message/Collections');

// Dynamo mock data factories
const {
  fakeCollectionFactory,
  fakeGranuleFactoryV2,
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

  const { esIndex, esClient } = await createTestIndex();
  t.context.esIndex = esIndex;
  t.context.esClient = esClient;
  t.context.esGranulesClient = new Search({}, 'granule', t.context.esIndex);

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
  const { TopicArn } = await sns().createTopic({ Name: topicName });
  process.env.granule_sns_topic_arn = TopicArn;
  t.context.TopicArn = TopicArn;

  const QueueName = randomString();
  const { QueueUrl } = await sqs().createQueue({ QueueName }).promise();
  t.context.QueueUrl = QueueUrl;
  const getQueueAttributesResponse = await sqs().getQueueAttributes({
    QueueUrl,
    AttributeNames: ['QueueArn'],
  }).promise();
  const QueueArn = getQueueAttributesResponse.Attributes.QueueArn;

  const { SubscriptionArn } = await sns().subscribe({
    TopicArn,
    Protocol: 'sqs',
    Endpoint: QueueArn,
  });

  t.context.SubscriptionArn = SubscriptionArn;
});

test.afterEach(async (t) => {
  const { QueueUrl, TopicArn } = t.context;
  await sqs().deleteQueue({ QueueUrl }).promise();
  await sns().deleteTopic({ TopicArn });
});

test.after.always(async (t) => {
  await destroyLocalTestDb({
    knex: t.context.knex,
    knexAdmin: t.context.knexAdmin,
    testDbName,
  });
  await cleanupTestIndex(t.context);
});

test.serial('deleteGranuleAndFiles() throws an error if the granule is published', async (t) => {
  const { newPgGranule, s3Buckets } = await createGranuleAndFiles({
    dbClient: t.context.knex,
    collectionId: t.context.collectionId,
    collectionCumulusId: t.context.collectionCumulusId,
    esClient: t.context.esClient,
    granuleParams: { published: true },
  });

  await t.throwsAsync(
    deleteGranuleAndFiles({
      knex: t.context.knex,
      pgGranule: newPgGranule,
      esClient: t.context.esClient,
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

test.serial('deleteGranuleAndFiles() removes granules from PostgreSQL/Elasticsearch and files from PostgreSQL/S3', async (t) => {
  const { collectionId, collectionCumulusId, esClient, esGranulesClient, knex } = t.context;

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
    esClient,
  });

  t.true(await granulePgModel.exists(knex, {
    granule_id: newPgGranule.granule_id,
    collection_cumulus_id: collectionCumulusId,
  }));
  t.true(
    await esGranulesClient.exists(
      newPgGranule.granule_id,
      collectionId
    )
  );
  await Promise.all(
    files.map(async (file) => {
      t.true(await s3ObjectExists({ Bucket: file.bucket, Key: file.key }));
      t.true(await filePgModel.exists(knex, { bucket: file.bucket, key: file.key }));
    })
  );

  const details = await deleteGranuleAndFiles({
    knex: knex,
    pgGranule: newPgGranule,
    esClient,
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
    esClient: t.context.esClient,
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
  t.false(
    await t.context.esGranulesClient.exists(
      newPgGranule.granule_id,
      t.context.collectionCumulusId
    )
  );
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
    esClient: t.context.esClient,
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
      esClient: t.context.esClient,
    }),
    { message: 'PG delete failed' }
  );

  // granule should still exist in PostgreSQL and Elasticsearch
  t.true(await granulePgModel.exists(
    t.context.knex,
    {
      granule_id: newPgGranule.granule_id,
      collection_cumulus_id: newPgGranule.collection_cumulus_id,
    }
  ));
  t.true(
    await t.context.esGranulesClient.exists(
      newPgGranule.granule_id,
      t.context.collectionId
    )
  );

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

test.serial('deleteGranuleAndFiles() will not delete granule or S3 files if the Elasticsearch granule delete fails', async (t) => {
  const {
    newPgGranule,
    files,
    s3Buckets,
  } = await createGranuleAndFiles({
    dbClient: t.context.knex,
    collectionId: t.context.collectionId,
    collectionCumulusId: t.context.collectionCumulusId,
    esClient: t.context.esClient,
    granuleParams: { published: false },
  });

  const fakeEsClient = {
    delete: () => {
      throw new Error('ES delete failed');
    },
    index: (record) => Promise.resolve({
      body: record,
    }),
  };

  await t.throwsAsync(
    deleteGranuleAndFiles({
      knex: t.context.knex,
      pgGranule: newPgGranule,
      esClient: fakeEsClient,
    }),
    { message: 'ES delete failed' }
  );

  // granule should still exist in PostgreSQL and elasticsearch
  t.true(await granulePgModel.exists(
    t.context.knex,
    {
      granule_id: newPgGranule.granule_id,
      collection_cumulus_id: newPgGranule.collection_cumulus_id,
    }
  ));
  t.true(
    await t.context.esGranulesClient.exists(
      newPgGranule.granule_id,
      t.context.collectionId
    )
  );

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

test.serial(
  'deleteGranuleAndFiles() does not require a PostgreSQL granule if an elasticsearch granule is present',
  async (t) => {
    // Create a granule in Dynamo only
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
    const granuleId = randomId('granule');
    const files = [
      {
        bucket: s3Buckets.protected.name,
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

    const newGranule = fakeGranuleFactoryV2({
      granuleId: granuleId,
      status: 'failed',
      published: false,
      files: files,
    });

    await createS3Buckets([s3Buckets.protected.name, s3Buckets.public.name]);

    // Add files to S3
    await Promise.all(
      newGranule.files.map((file) =>
        s3PutObject({
          Bucket: file.bucket,
          Key: file.key,
          Body: `test data ${randomString()}`,
        }))
    );

    // Add granule to elasticsearch
    const esGranulesClient = new Search(
      {},
      'granule',
      process.env.ES_INDEX
    );

    await t.context.esClient.index({
      index: t.context.esIndex,
      type: 'granule',
      id: newGranule.granuleId,
      parent: 'fakeCollectionId',
      body: newGranule,
    });

    await deleteGranuleAndFiles({
      knex: t.context.knex,
      apiGranule: newGranule,
      pgGranule: undefined,
      esClient: t.context.esClient,
    });

    // verify the files are deleted from S3.
    await Promise.all(
      files.map(async (file) => {
        t.false(await s3ObjectExists({ Bucket: file.bucket, Key: file.key }));
      })
    );

    // Verify record is removed from elasticsearch

    const esResult = await esGranulesClient.get(newGranule.granuleId);
    t.is(esResult.detail, recordNotFoundString);

    t.teardown(() =>
      deleteS3Buckets([s3Buckets.protected.name, s3Buckets.public.name]));
  }
);
