'use strict';

const test = require('ava');

const cryptoRandomString = require('crypto-random-string');
const {
  CollectionPgModel,
  destroyLocalTestDb,
  ExecutionPgModel,
  fakeCollectionRecordFactory,
  fakeExecutionRecordFactory,
  fakeGranuleRecordFactory,
  fakePdrRecordFactory,
  fakeProviderRecordFactory,
  generateLocalTestDb,
  GranulePgModel,
  localStackConnectionEnv,
  migrationDir,
  PdrPgModel,
  ProviderPgModel,
  translateApiExecutionToPostgresExecution,
  translatePostgresGranuleToApiGranule,
  upsertGranuleWithExecutionJoinRecord,
} = require('@cumulus/db');

const { createTestIndex, cleanupTestIndex } = require('@cumulus/es-client/testUtils');

const {
  createBucket,
  recursivelyDeleteS3Bucket,
  s3PutObject,
} = require('@cumulus/aws-client/S3');

const { secretsManager, sns, sqs } = require('@cumulus/aws-client/services');
const indexer = require('@cumulus/es-client/indexer');
const { Search } = require('@cumulus/es-client/search');
const { randomString, randomId } = require('@cumulus/common/test-utils');

const { constructCollectionId } = require('@cumulus/message/Collections');

const { createGranuleAndFiles } = require('../../helpers/create-test-data');
const models = require('../../../models');

const { request } = require('../../helpers/request');

// Dynamo mock data factories
const {
  createFakeJwtAuthToken,
  setAuthorizedOAuthUsers,
  fakeExecutionFactoryV2,
} = require('../../../lib/testUtils');

const testDbName = `granules_${cryptoRandomString({ length: 10 })}`;

let accessTokenModel;
let executionPgModel;
let jwtAuthToken;

process.env.AccessTokensTable = randomId('token');
process.env.stackName = randomId('stackname');
process.env.system_bucket = randomId('system-bucket');
process.env.TOKEN_SECRET = randomId('secret');
process.env.backgroundQueueUrl = randomId('backgroundQueueUrl');

// import the express app after setting the env variables
const { app } = require('../../../app');

test.before(async (t) => {
  process.env.CMR_ENVIRONMENT = 'SIT';
  process.env = {
    ...process.env,
    ...localStackConnectionEnv,
    PG_DATABASE: testDbName,
  };

  // create a fake bucket
  await createBucket(process.env.system_bucket);

  // create a workflow template file
  const tKey = `${process.env.stackName}/workflow_template.json`;
  await s3PutObject({ Bucket: process.env.system_bucket, Key: tKey, Body: '{}' });
  executionPgModel = new ExecutionPgModel();

  const username = randomString();
  await setAuthorizedOAuthUsers([username]);

  accessTokenModel = new models.AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, username });

  // Store the CMR password
  process.env.cmr_password_secret_name = randomString();
  await secretsManager()
    .createSecret({
      Name: process.env.cmr_password_secret_name,
      SecretString: randomString(),
    })
    .promise();

  // Store the Launchpad passphrase
  process.env.launchpad_passphrase_secret_name = randomString();
  await secretsManager()
    .createSecret({
      Name: process.env.launchpad_passphrase_secret_name,
      SecretString: randomString(),
    })
    .promise();

  // Generate a local test postGres database
  const { knex, knexAdmin } = await generateLocalTestDb(testDbName, migrationDir);
  t.context.knex = knex;
  t.context.knexAdmin = knexAdmin;

  const { esIndex, esClient } = await createTestIndex();
  t.context.esIndex = esIndex;
  t.context.esClient = esClient;

  t.context.esGranulesClient = new Search({}, 'granule', process.env.ES_INDEX);

  // Create collections in Postgres
  // we need this because a granule has a foreign key referring to collections
  t.context.collectionName = 'fakeCollection';
  t.context.collectionVersion = 'v1';
  t.context.collectionId = constructCollectionId(
    t.context.collectionName,
    t.context.collectionVersion
  );
  t.context.testPgCollection = fakeCollectionRecordFactory({
    name: t.context.collectionName,
    version: t.context.collectionVersion,
  });

  const collectionName2 = 'fakeCollection2';
  const collectionVersion2 = 'v2';
  t.context.collectionId2 = constructCollectionId(
    t.context.collectionName2,
    t.context.collectionVersion2
  );
  t.context.testPgCollection2 = fakeCollectionRecordFactory({
    name: collectionName2,
    version: collectionVersion2,
  });
  t.context.collectionPgModel = new CollectionPgModel();
  const [pgCollection] = await t.context.collectionPgModel.create(
    t.context.knex,
    t.context.testPgCollection
  );
  const [pgCollection2] = await t.context.collectionPgModel.create(
    t.context.knex,
    t.context.testPgCollection2
  );

  t.context.provider = fakeProviderRecordFactory();
  t.context.providerPgModel = new ProviderPgModel();

  const [pgProvider] = await t.context.providerPgModel.create(
    t.context.knex,
    t.context.provider
  );
  t.context.providerCumulusId = pgProvider.cumulus_id;

  t.context.pdrPgModel = new PdrPgModel();
  t.context.pdr = fakePdrRecordFactory({
    collection_cumulus_id: pgCollection.cumulus_id,
    provider_cumulus_id: t.context.providerCumulusId,
  });

  const [pgPdr] = await t.context.pdrPgModel.create(
    t.context.knex,
    t.context.pdr
  );
  t.context.providerPdrId = pgPdr;

  // Create execution in Dynamo/Postgres
  // we need this as granules *should have* a related execution

  t.context.testExecution = fakeExecutionRecordFactory();
  const [testExecution] = await executionPgModel.create(t.context.knex, t.context.testExecution);
  t.context.testExecutionCumulusId = testExecution.cumulus_id;
  t.context.collectionCumulusId = pgCollection.cumulus_id;
  t.context.collectionCumulusId2 = pgCollection2.cumulus_id;

  const newExecution = fakeExecutionFactoryV2({
    arn: 'arn3',
    status: 'completed',
    name: 'test_execution',
    parentArn: undefined,
  });

  const executionRecord = await translateApiExecutionToPostgresExecution(newExecution, knex);
  t.context.executionPgRecord = (await executionPgModel.create(knex, executionRecord))[0];
  t.context.executionUrl = executionRecord.url;
  t.context.executionArn = executionRecord.arn;
});

test.beforeEach(async (t) => {
  t.context.createGranuleId = () => `${cryptoRandomString({ length: 7 })}.${cryptoRandomString({ length: 20 })}.hdf`;
  const granuleId1 = t.context.createGranuleId();
  const granuleId2 = t.context.createGranuleId();
  const granuleId3 = t.context.createGranuleId();

  // create fake Postgres granule records
  t.context.fakePGGranules = [
    fakeGranuleRecordFactory({
      granule_id: granuleId1,
      status: 'completed',
      collection_cumulus_id: t.context.collectionCumulusId,
      published: true,
      cmr_link:
        'https://cmr.uat.earthdata.nasa.gov/search/granules.json?concept_id=A123456789-TEST_A',
      duration: 47.125,
      timestamp: new Date(Date.now()),
    }),
    fakeGranuleRecordFactory({
      granule_id: granuleId2,
      status: 'failed',
      collection_cumulus_id: t.context.collectionCumulusId,
      duration: 52.235,
      timestamp: new Date(Date.now()),
    }),
    fakeGranuleRecordFactory({
      granule_id: granuleId3,
      status: 'failed',
      collection_cumulus_id: t.context.collectionCumulusId,
      duration: 52.235,
      timestamp: new Date(Date.now()),
    }),
    // granule with same granule_id as above but different collection_cumulus_id
    fakeGranuleRecordFactory({
      granule_id: granuleId3,
      status: 'failed',
      collection_cumulus_id: t.context.collectionCumulusId2,
      duration: 52.235,
      timestamp: new Date(Date.now()),
    }),
  ];

  t.context.fakePGGranuleRecords = await Promise.all(
    t.context.fakePGGranules.map((granule) =>
      upsertGranuleWithExecutionJoinRecord({
        knexTransaction: t.context.knex,
        granule,
        executionCumulusId: t.context.testExecutionCumulusId,
        granulePgModel: new GranulePgModel(),
      }))
  );
  t.context.insertedPgGranules = t.context.fakePGGranuleRecords.flat();
  const insertedApiGranuleTranslations = await Promise.all(
    t.context.insertedPgGranules.map((granule) =>
      translatePostgresGranuleToApiGranule({
        knexOrTransaction: t.context.knex,
        granulePgRecord: granule,
      }))
  );
  // index PG Granules into ES
  await Promise.all(
    insertedApiGranuleTranslations.map((granule) =>
      indexer.indexGranule(t.context.esClient, granule, t.context.esIndex))
  );

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

  const { SubscriptionArn } = await sns()
    .subscribe({
      TopicArn,
      Protocol: 'sqs',
      Endpoint: QueueArn,
    })
    .promise();

  await sns()
    .confirmSubscription({
      TopicArn,
      Token: SubscriptionArn,
    })
    .promise();
});

test.afterEach(async (t) => {
  const { QueueUrl, TopicArn } = t.context;
  await sqs().deleteQueue({ QueueUrl }).promise();
  await sns().deleteTopic({ TopicArn }).promise();
});

test.after.always(async (t) => {
  await accessTokenModel.deleteTable();
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
  await secretsManager()
    .deleteSecret({
      SecretId: process.env.cmr_password_secret_name,
      ForceDeleteWithoutRecovery: true,
    })
    .promise();
  await secretsManager()
    .deleteSecret({
      SecretId: process.env.launchpad_passphrase_secret_name,
      ForceDeleteWithoutRecovery: true,
    })
    .promise();

  await destroyLocalTestDb({
    knex: t.context.knex,
    knexAdmin: t.context.knexAdmin,
    testDbName,
  });
  await cleanupTestIndex(t.context);
});

test.serial('bulkUpdateGranules does not update granules with missing collectionIds', async (t) => {
  const granuleId1 = randomId('new-granule');
  const granuleId2 = randomId('new-granule');
  const granuleId3 = randomId('new-granule');
  const granules = [granuleId1, granuleId2, granuleId3].map((granuleId) => ({
    granuleId,
    status: 'queued',
  }));
  const response = await request(app)
    .post('/granules/bulkUpdate')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send({ granules });

  t.is(response.status, 400);
  t.is(JSON.parse(response.text).message, 'All granules must have a collectionId defined.');
});

test.serial('bulkUpdateGranules does not allow empty requests', async (t) => {
  const response = await request(app)
    .post('/granules/bulkUpdate')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send({ granules: [] });

  t.is(response.status, 400);
  t.is(JSON.parse(response.text).message, 'no values provided for granules');
});

test.serial('bulkUpdateGranules does not allow mismatched collection ids', async (t) => {
  const [granule1, granule2, granule3, granule4] = t.context.insertedPgGranules;
  const newNow = Date.now();
  const granules = [
    {
      granuleId: granule1.granule_id,
      collectionId: t.context.collectionId,
      status: 'queued',
      createdAt: newNow,
    },
    {
      granuleId: granule2.granule_id,
      collectionId: t.context.collectionId,
      status: 'queued',
      createdAt: newNow,
    },
    {
      granuleId: granule3.granule_id,
      collectionId: t.context.collectionId,
      status: 'queued',
      createdAt: newNow,
    },
    {
      granuleId: granule4.granule_id,
      collectionId: t.context.collectionId2,
      status: 'queued',
      createdAt: newNow,
    },
  ];
  const response = await request(app)
    .post('/granules/bulkUpdate')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send({ granules });

  t.is(response.status, 400);
  t.is(JSON.parse(response.text).message, `All granules must be in the same collection (${t.context.collectionId}).`);
});

test.serial('bulkUpdateGranules can create new granules with status queued', async (t) => {
  const granuleId = randomId('new-granule');
  const response = await request(app)
    .post('/granules/bulkUpdate')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send({
      granules: [{
        granuleId: granuleId,
        status: 'queued',
        collectionId: t.context.collectionId,
      }],
    });

  t.is(response.status, 200);
  t.deepEqual(JSON.parse(response.text), {
    message: 'Granules updated',
  });

  const granulePgModel = new GranulePgModel();
  const actualPgGranule = await granulePgModel.get(t.context.knex, {
    granule_id: granuleId,
    collection_cumulus_id: t.context.collectionCumulusId,
  });
  const actualEsGranule = await t.context.esGranulesClient.get(granuleId);

  t.deepEqual(actualPgGranule.status, 'queued');
  t.is(actualEsGranule.status, 'queued');
});

test.serial('bulkUpdateGranules can update granules', async (t) => {
  const granule1 = t.context.insertedPgGranules[0];
  const granule2 = t.context.insertedPgGranules[1];
  const newNow = Date.now();
  const granules = [
    {
      granuleId: granule1.granule_id,
      collectionId: t.context.collectionId,
      status: 'queued',
    },
    {
      granuleId: granule2.granule_id,
      collectionId: t.context.collectionId,
      status: 'queued',
      createdAt: newNow,
    },
  ];
  const response = await request(app)
    .post('/granules/bulkUpdate')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send({ granules });

  t.is(response.status, 200);
  t.deepEqual(JSON.parse(response.text), {
    message: 'Granules updated',
  });

  const granulePgModel = new GranulePgModel();
  const pgGranule1 = await granulePgModel.get(t.context.knex, {
    granule_id: granule1.granule_id,
    collection_cumulus_id: t.context.collectionCumulusId,
  });
  const esGranule1 = await t.context.esGranulesClient.get(granule1.granule_id);
  t.deepEqual(pgGranule1.status, 'queued');
  t.is(esGranule1.status, 'queued');
  t.deepEqual(pgGranule1.created_at, granule1.created_at);
  t.is(esGranule1.createdAt, granule1.created_at.getTime());

  const pgGranule2 = await granulePgModel.get(t.context.knex, {
    granule_id: granule2.granule_id,
    collection_cumulus_id: t.context.collectionCumulusId,
  });
  const esGranule2 = await t.context.esGranulesClient.get(granule2.granule_id);
  t.deepEqual(pgGranule2.status, 'queued');
  t.is(esGranule2.status, 'queued');
  t.deepEqual(pgGranule2.created_at, new Date(newNow));
  t.is(esGranule2.createdAt, newNow);
});

test.serial('bulkUpdateGranules does not update createdAt of an existing granule if not specified in the payload', async (t) => {
  const { esClient, executionUrl, knex } = t.context;

  const timestamp = Date.now();
  const createdAt = timestamp - 1000000;

  const { newPgGranule, esRecord } = await createGranuleAndFiles({
    dbClient: knex,
    esClient,
    execution: executionUrl,
    granuleParams: {
      createdAt,
      status: 'completed',
    },
  });

  // Verify returned objects have correct status
  t.is(newPgGranule.status, 'completed');
  t.is(esRecord.status, 'completed');
  t.deepEqual(newPgGranule.created_at, new Date(createdAt));
  t.is(esRecord.createdAt, createdAt);

  const updatedGranule = {
    granuleId: esRecord.granuleId,
    collectionId: esRecord.collectionId,
    status: 'completed',
  };

  await request(app)
    .post('/granules/bulkUpdate')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send({ granules: [updatedGranule] })
    .expect(200);

  const granulePgModel = new GranulePgModel();
  const actualPgGranule = await granulePgModel.get(t.context.knex, {
    cumulus_id: newPgGranule.cumulus_id,
  });
  const actualEsGranule = await t.context.esGranulesClient.get(esRecord.granuleId);

  t.deepEqual(actualPgGranule.created_at, new Date(createdAt));
  t.is(actualEsGranule.createdAt, createdAt);
});
