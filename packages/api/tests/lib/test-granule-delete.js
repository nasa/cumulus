const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const {
  sns,
  sqs,
} = require('@cumulus/aws-client/services');
const {
  createBucket,
  createS3Buckets,
  deleteS3Buckets,
  s3ObjectExists,
  s3PutObject,
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

const models = require('../../models');

// Dynamo mock data factories
const {
  fakeCollectionFactory,
  fakeGranuleFactoryV2,
} = require('../../lib/testUtils');

const { deleteGranuleAndFiles } = require('../../src/lib/granule-delete');
const { createGranuleAndFiles } = require('../helpers/create-test-data');

const testDbName = `granules_${cryptoRandomString({ length: 10 })}`;

let filePgModel;
let granuleModel;
let granulePgModel;

process.env.CollectionsTable = randomId('collections');
process.env.GranulesTable = randomId('granules');
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

  // create fake Granules table
  granuleModel = new models.Granule();
  await granuleModel.createTable();

  const collectionModel = new models.Collection();
  await collectionModel.createTable();

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
  await collectionModel.create(t.context.testCollection);
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
  const { TopicArn } = await sns().createTopic({ Name: topicName }).promise();
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
  }).promise();

  await sns().confirmSubscription({
    TopicArn,
    Token: SubscriptionArn,
  }).promise();
});

test.afterEach(async (t) => {
  const { QueueUrl, TopicArn } = t.context;
  await sqs().deleteQueue({ QueueUrl }).promise();
  await sns().deleteTopic({ TopicArn }).promise();
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
  const { newPgGranule, newDynamoGranule, s3Buckets } = await createGranuleAndFiles({
    dbClient: t.context.knex,
    collectionId: t.context.collectionId,
    collectionCumulusId: t.context.collectionCumulusId,
    esClient: t.context.esClient,
    granuleParams: { published: true },
  });

  await t.throwsAsync(
    deleteGranuleAndFiles({
      knex: t.context.knex,
      dynamoGranule: newDynamoGranule,
      pgGranule: newPgGranule,
      esClient: t.context.esClient,
    }),
    { instanceOf: DeletePublishedGranule }
  );

  // Check Dynamo and RDS. The granule should still exist in both.
  t.true(await granuleModel.exists({ granuleId: newDynamoGranule.granuleId }));
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

test.serial('deleteGranuleAndFiles() removes granule PostgreSQL/DynamoDB/Elasticsearch and files from PostgreSQL/S3', async (t) => {
  const {
    newPgGranule,
    newDynamoGranule,
    files,
    s3Buckets,
  } = await createGranuleAndFiles({
    dbClient: t.context.knex,
    collectionId: t.context.collectionId,
    collectionCumulusId: t.context.collectionCumulusId,
    granuleParams: { published: false },
    esClient: t.context.esClient,
  });

  t.true(await granuleModel.exists({ granuleId: newDynamoGranule.granuleId }));
  t.true(await granulePgModel.exists(t.context.knex, {
    granule_id: newPgGranule.granule_id,
    collection_cumulus_id: t.context.collectionCumulusId,
  }));
  t.true(
    await t.context.esGranulesClient.exists(
      newDynamoGranule.granuleId,
      newDynamoGranule.collectionId
    )
  );
  await Promise.all(
    files.map(async (file) => {
      t.true(await s3ObjectExists({ Bucket: file.bucket, Key: file.key }));
      t.true(await filePgModel.exists(t.context.knex, { bucket: file.bucket, key: file.key }));
    })
  );

  const details = await deleteGranuleAndFiles({
    knex: t.context.knex,
    dynamoGranule: newDynamoGranule,
    pgGranule: newPgGranule,
    esClient: t.context.esClient,
  });

  t.truthy(details.deletionTime);
  t.like(details, {
    collection: t.context.collectionId,
    deletedGranuleId: newDynamoGranule.granuleId,
  });
  t.is(details.deletedFiles.length, newDynamoGranule.files.length);

  t.false(await granuleModel.exists({ granuleId: newDynamoGranule.granuleId }));

  t.false(await granulePgModel.exists(
    t.context.knex,
    {
      granule_id: newPgGranule.granule_id,
      collection_cumulus_id: newPgGranule.collection_cumulus_id,
    }
  ));
  t.false(
    await t.context.esGranulesClient.exists(
      newDynamoGranule.granuleId,
      newDynamoGranule.collectionId
    )
  );

  // Verify files were deleted from S3 and Postgres
  await Promise.all(
    files.map(async (file) => {
      t.false(await s3ObjectExists({ Bucket: file.bucket, Key: file.key }));
      t.false(await filePgModel.exists(t.context.knex, { bucket: file.bucket, key: file.key }));
    })
  );

  t.teardown(() => deleteS3Buckets([
    s3Buckets.protected.name,
    s3Buckets.public.name,
  ]));
});

test.serial('deleteGranuleAndFiles() succeeds if a file is not present in S3', async (t) => {
  const granuleId = randomId('granule');
  const files = [
    {
      bucket: process.env.system_bucket,
      fileName: `${granuleId}.hdf`,
      key: randomString(),
    },
  ];

  // Create Dynamo granule
  const newGranule = fakeGranuleFactoryV2({ granuleId: granuleId, status: 'failed', published: false, files });
  await granuleModel.create(newGranule);

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

  const newPgGranule = await granulePgModel.get(t.context.knex, {
    cumulus_id: pgGranule.cumulus_id,
  });
  const newDynamoGranule = await granuleModel.get({ granuleId: newGranule.granuleId });

  const details = await deleteGranuleAndFiles({
    knex: t.context.knex,
    dynamoGranule: newDynamoGranule,
    pgGranule: newPgGranule,
    esClient: t.context.esClient,
  });

  t.truthy(details.deletionTime);
  t.like(details, {
    collection: t.context.collectionId,
    deletedGranuleId: newDynamoGranule.granuleId,
  });
  t.is(details.deletedFiles.length, 0);

  t.false(
    await granuleModel.exists({ granuleId: newDynamoGranule.granuleId })
  );

  t.false(await granulePgModel.exists(
    t.context.knex,
    {
      granule_id: newPgGranule.granule_id,
      collection_cumulus_id: newPgGranule.collection_cumulus_id,
    }
  ));
  t.false(
    await t.context.esGranulesClient.exists(
      newDynamoGranule.granuleId,
      newDynamoGranule.collectionId
    )
  );
});

test.serial('deleteGranuleAndFiles() will not delete granule or S3 Files if the PostgreSQL granule delete fails', async (t) => {
  const {
    newPgGranule,
    newDynamoGranule,
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
      dynamoGranule: newDynamoGranule,
      pgGranule: newPgGranule,
      granulePgModel: mockGranuleModel,
      esClient: t.context.esClient,
    }),
    { message: 'PG delete failed' }
  );

  // granule should still exist in DynamoDB and PostgreSQL
  t.true(await granulePgModel.exists(
    t.context.knex,
    {
      granule_id: newPgGranule.granule_id,
      collection_cumulus_id: newPgGranule.collection_cumulus_id,
    }
  ));
  t.true(await granuleModel.exists({ granuleId: newDynamoGranule.granuleId }));
  t.true(
    await t.context.esGranulesClient.exists(
      newDynamoGranule.granuleId,
      newDynamoGranule.collectionId
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

test.serial('deleteGranuleAndFiles() will not delete granule or S3 files if the DynamoDB granule delete fails', async (t) => {
  const {
    newPgGranule,
    newDynamoGranule,
    files,
    s3Buckets,
  } = await createGranuleAndFiles({
    dbClient: t.context.knex,
    collectionId: t.context.collectionId,
    collectionCumulusId: t.context.collectionCumulusId,
    esClient: t.context.esClient,
    granuleParams: { published: false },
  });

  const mockGranuleDynamoModel = {
    delete: () => {
      throw new Error('Dynamo delete failed');
    },
    create: () => Promise.resolve(),
  };

  await t.throwsAsync(
    deleteGranuleAndFiles({
      knex: t.context.knex,
      dynamoGranule: newDynamoGranule,
      pgGranule: newPgGranule,
      granuleModelClient: mockGranuleDynamoModel,
      esClient: t.context.esClient,
    }),
    { message: 'Dynamo delete failed' }
  );

  // granule should still exist in DynamoDB and PostgreSQL
  t.true(await granulePgModel.exists(
    t.context.knex,
    {
      granule_id: newPgGranule.granule_id,
      collection_cumulus_id: newPgGranule.collection_cumulus_id,
    }
  ));
  t.true(await granuleModel.exists({ granuleId: newDynamoGranule.granuleId }));
  t.true(
    await t.context.esGranulesClient.exists(
      newDynamoGranule.granuleId,
      newDynamoGranule.collectionId
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
    newDynamoGranule,
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
      dynamoGranule: newDynamoGranule,
      pgGranule: newPgGranule,
      esClient: fakeEsClient,
    }),
    { message: 'ES delete failed' }
  );

  // granule should still exist in DynamoDB and PostgreSQL
  t.true(await granulePgModel.exists(
    t.context.knex,
    {
      granule_id: newPgGranule.granule_id,
      collection_cumulus_id: newPgGranule.collection_cumulus_id,
    }
  ));
  t.true(await granuleModel.exists({ granuleId: newDynamoGranule.granuleId }));
  t.true(
    await t.context.esGranulesClient.exists(
      newDynamoGranule.granuleId,
      newDynamoGranule.collectionId
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

test.serial('deleteGranuleAndFiles() does not require a PostgreSQL granule', async (t) => {
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

  const newGranule = fakeGranuleFactoryV2(
    {
      granuleId: granuleId,
      status: 'failed',
      published: false,
      files: files,
    }
  );

  await createS3Buckets([
    s3Buckets.protected.name,
    s3Buckets.public.name,
  ]);

  // Add files to S3
  await Promise.all(newGranule.files.map((file) => s3PutObject({
    Bucket: file.bucket,
    Key: file.key,
    Body: `test data ${randomString()}`,
  })));

  // create a new Dynamo granule
  await granuleModel.create(newGranule);

  const details = await deleteGranuleAndFiles({
    knex: t.context.knex,
    dynamoGranule: newGranule,
    pgGranule: undefined,
    esClient: t.context.esClient,
  });

  t.truthy(details.deletionTime);
  t.like(details, {
    collection: t.context.collectionId,
    deletedGranuleId: newGranule.granuleId,
  });
  t.is(details.deletedFiles.length, newGranule.files.length);

  // Granule should have been removed from Dynamo
  t.false(
    await granuleModel.exists({ granuleId })
  );
  t.false(
    await t.context.esGranulesClient.exists(
      granuleId,
      newGranule.collectionId
    )
  );

  // verify the files are deleted from S3.
  await Promise.all(
    files.map(async (file) => {
      t.false(await s3ObjectExists({ Bucket: file.bucket, Key: file.key }));
    })
  );

  t.teardown(() => deleteS3Buckets([
    s3Buckets.protected.name,
    s3Buckets.public.name,
  ]));
});

test.serial('deleteGranuleAndFiles() does not require a DynamoDB granule', async (t) => {
  const {
    newPgGranule,
    files,
    s3Buckets,
  } = await createGranuleAndFiles({
    dbClient: t.context.knex,
    collectionId: t.context.collectionId,
    collectionCumulusId: t.context.collectionCumulusId,
    granuleParams: { published: false },
    esClient: t.context.esClient,
  });

  await granuleModel.delete({ granuleId: newPgGranule.granule_id });

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
  t.is(details.deletedFiles.length, files.length);

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
      t.context.collectionId
    )
  );

  // Verify files were deleted from S3 and Postgres
  await Promise.all(
    files.map(async (file) => {
      t.false(await s3ObjectExists({ Bucket: file.bucket, Key: file.key }));
      t.false(await filePgModel.exists(t.context.knex, { bucket: file.bucket, key: file.key }));
    })
  );

  t.teardown(() => deleteS3Buckets([
    s3Buckets.protected.name,
    s3Buckets.public.name,
  ]));
});
