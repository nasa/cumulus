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

const {
  createBucket,
  recursivelyDeleteS3Bucket,
  s3PutObject,
} = require('@cumulus/aws-client/S3');
const { createSnsTopic } = require('@cumulus/aws-client/SNS');
const { secretsManager, sns, sqs } = require('@cumulus/aws-client/services');
const {
  SubscribeCommand,
  DeleteTopicCommand,
} = require('@aws-sdk/client-sns');
const { randomString, randomId } = require('@cumulus/common/test-utils');

const { constructCollectionId } = require('@cumulus/message/Collections');

const assertions = require('../../lib/assertions');
const models = require('../../models');

const { request } = require('../helpers/request');

// Dynamo mock data factories
const {
  createFakeJwtAuthToken,
  fakeAccessTokenFactory,
  setAuthorizedOAuthUsers,
  fakeExecutionFactoryV2,
} = require('../../lib/testUtils');
const { createJwtToken } = require('../../lib/token');

const testDbName = `granules_${cryptoRandomString({ length: 10 })}`;

let accessTokenModel;
let executionPgModel;
let granulePgModel;
let jwtAuthToken;

process.env.AccessTokensTable = randomId('token');
process.env.stackName = randomId('stackname');
process.env.system_bucket = randomId('system-bucket');
process.env.TOKEN_SECRET = randomId('secret');
process.env.backgroundQueueUrl = randomId('backgroundQueueUrl');

// import the express app after setting the env variables
const { app } = require('../../app');

test.before(() => {
  process.env.CMR_ENVIRONMENT = 'SIT';
  process.env = {
    ...process.env,
    ...localStackConnectionEnv,
    PG_DATABASE: testDbName,
  };
});

test.beforeEach(async (t) => {
  // create a fake bucket
  await createBucket(process.env.system_bucket);

  // create a workflow template file
  const tKey = `${process.env.stackName}/workflow_template.json`;
  await s3PutObject({ Bucket: process.env.system_bucket, Key: tKey, Body: '{}' });
  executionPgModel = new ExecutionPgModel();

  granulePgModel = new GranulePgModel();
  t.context.granulePgModel = granulePgModel;

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
    });

  // Store the Launchpad passphrase
  process.env.launchpad_passphrase_secret_name = randomString();
  await secretsManager()
    .createSecret({
      Name: process.env.launchpad_passphrase_secret_name,
      SecretString: randomString(),
    });

  // Generate a local test postGres database

  const { knex, knexAdmin } = await generateLocalTestDb(testDbName, migrationDir);
  t.context.knex = knex;
  t.context.knexAdmin = knexAdmin;

  // Create collections in Postgres
  // we need this because a granule has a foreign key referring to collections
  t.context.collectionName = 'fakeCollection';
  t.context.collectionVersion = 'v1';

  const collectionName2 = 'fakeCollection2';
  const collectionVersion2 = 'v2';

  t.context.collectionId = constructCollectionId(
    t.context.collectionName,
    t.context.collectionVersion
  );

  t.context.testPgCollection = fakeCollectionRecordFactory({
    name: t.context.collectionName,
    version: t.context.collectionVersion,
  });
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
  t.context.createGranuleId = () => `${cryptoRandomString({ length: 7 })}.${cryptoRandomString({ length: 20 })}.hdf`;
  const granuleId1 = t.context.createGranuleId();
  const granuleId2 = t.context.createGranuleId();
  const granuleId3 = t.context.createGranuleId();
  const timestamp = new Date();

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
      timestamp,
      updated_at: timestamp,
    }),
    fakeGranuleRecordFactory({
      granule_id: granuleId2,
      status: 'failed',
      collection_cumulus_id: t.context.collectionCumulusId,
      duration: 52.235,
      timestamp,
      updated_at: timestamp,
    }),
    fakeGranuleRecordFactory({
      granule_id: granuleId3,
      status: 'failed',
      collection_cumulus_id: t.context.collectionCumulusId,
      duration: 52.235,
      timestamp,
      updated_at: timestamp,
    }),
    // granule with same granule_id as above but different collection_cumulus_id
    fakeGranuleRecordFactory({
      granule_id: granuleId3,
      status: 'failed',
      collection_cumulus_id: t.context.collectionCumulusId2,
      duration: 52.235,
      timestamp,
      updated_at: timestamp,
    }),
  ];
  t.context.fakePGGranuleRecords = await Promise.all(
    t.context.fakePGGranules.map((granule) =>
      upsertGranuleWithExecutionJoinRecord({
        knexTransaction: t.context.knex,
        granule,
        executionCumulusId: t.context.testExecutionCumulusId,
        granulePgModel: t.context.granulePgModel,
      }))
  );
  t.context.insertedPgGranules = t.context.fakePGGranuleRecords.flat();

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
  await accessTokenModel.deleteTable();
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
  await secretsManager()
    .deleteSecret({
      SecretId: process.env.cmr_password_secret_name,
      ForceDeleteWithoutRecovery: true,
    });
  await secretsManager()
    .deleteSecret({
      SecretId: process.env.launchpad_passphrase_secret_name,
      ForceDeleteWithoutRecovery: true,
    });

  await destroyLocalTestDb({
    knex: t.context.knex,
    knexAdmin: t.context.knexAdmin,
    testDbName,
  });
});

// TODO postgres query doesn't return searchContext
test.serial.skip('default lists and paginates correctly with search_after', async (t) => {
  const granuleIds = t.context.fakePGGranules.map((i) => i.granule_id);
  const response = await request(app)
    .get('/granules')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const { meta, results } = response.body;
  t.is(results.length, 3);
  t.is(meta.stack, process.env.stackName);
  t.is(meta.table, 'granule');
  t.is(meta.count, 3);
  results.forEach((r) => {
    t.true(granuleIds.includes(r.granuleId));
  });
  // default paginates correctly with search_after
  const firstResponse = await request(app)
    .get('/granules?limit=1')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const { meta: firstMeta, results: firstResults } = firstResponse.body;
  t.is(firstResults.length, 1);
  t.is(firstMeta.page, 1);
  t.truthy(firstMeta.searchContext);

  const newResponse = await request(app)
    .get(`/granules?limit=1&page=2&searchContext=${firstMeta.searchContext}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const { meta: newMeta, results: newResults } = newResponse.body;
  t.is(newResults.length, 1);
  t.is(newMeta.page, 2);
  t.truthy(newMeta.searchContext);

  t.true(granuleIds.includes(results[0].granuleId));
  t.true(granuleIds.includes(newResults[0].granuleId));
  t.not(results[0].granuleId, newResults[0].granuleId);
  t.not(meta.searchContext === newMeta.searchContext);
});

test.serial('default lists and paginates correctly from querying database', async (t) => {
  const granuleIds = t.context.fakePGGranules.map((i) => i.granule_id);
  const response = await request(app)
    .get('/granules')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const { meta, results } = response.body;
  t.is(results.length, 4);
  t.is(meta.stack, process.env.stackName);
  t.is(meta.table, 'granules');
  t.true(meta.count > 0);
  results.forEach((r) => {
    t.true(granuleIds.includes(r.granuleId));
  });
  // default paginates correctly
  const firstResponse = await request(app)
    .get('/granules?limit=1')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const { meta: firstMeta, results: firstResults } = firstResponse.body;
  t.is(firstResults.length, 1);
  t.is(firstMeta.page, 1);

  const newResponse = await request(app)
    .get('/granules?limit=1&page=2')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const { meta: newMeta, results: newResults } = newResponse.body;
  t.is(newResults.length, 1);
  t.is(newMeta.page, 2);

  t.true(granuleIds.includes(results[0].granuleId));
  t.true(granuleIds.includes(newResults[0].granuleId));
  t.not(results[0].granuleId, newResults[0].granuleId);
});

test.serial('CUMULUS-911 GET without pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .get('/granules')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test.serial('CUMULUS-911 GET with pathParameters.granuleId set and without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .get('/granules/asdf')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test.serial('CUMULUS-912 GET without pathParameters and with an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(app)
    .get('/granules/asdf')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(401);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test.serial('CUMULUS-912 GET without pathParameters and with an unauthorized user returns an unauthorized response', async (t) => {
  const accessTokenRecord = fakeAccessTokenFactory();
  await accessTokenModel.create(accessTokenRecord);
  const jwtToken = createJwtToken(accessTokenRecord);

  const response = await request(app)
    .get('/granules')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtToken}`)
    .expect(401);

  assertions.isUnauthorizedUserResponse(t, response);
});

test.serial('CUMULUS-912 GET with pathParameters.granuleId set and with an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(app)
    .get('/granules/asdf')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(401);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test.todo('CUMULUS-912 GET with pathParameters.granuleId set and with an unauthorized user returns an unauthorized response');

test.serial('GET returns the expected existing granule if a collectionId is NOT provided', async (t) => {
  const { knex, fakePGGranules } = t.context;

  const response = await request(app)
    .get(`/granules/${t.context.fakePGGranules[0].granule_id}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const pgGranule = await granulePgModel.get(knex, {
    granule_id: fakePGGranules[0].granule_id,
    collection_cumulus_id: fakePGGranules[0].collection_cumulus_id,
  });

  const expectedGranule = await translatePostgresGranuleToApiGranule({
    granulePgRecord: pgGranule,
    knexOrTransaction: knex,
  });

  t.deepEqual(response.body, expectedGranule);
});

test.serial('GET returns the expected existing granule if a collectionId is provided', async (t) => {
  const { knex, fakePGGranules, testPgCollection } = t.context;

  const collectionId = constructCollectionId(testPgCollection.name, testPgCollection.version);

  const response = await request(app)
    .get(`/granules/${collectionId}/${t.context.fakePGGranules[2].granule_id}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const pgGranule = await granulePgModel.get(knex, {
    granule_id: fakePGGranules[2].granule_id,
    collection_cumulus_id: fakePGGranules[2].collection_cumulus_id,
  });

  const expectedGranule = await translatePostgresGranuleToApiGranule({
    granulePgRecord: pgGranule,
    knexOrTransaction: knex,
  });

  t.deepEqual(response.body, expectedGranule);
});

test.serial('GET returns a granule that has no files with the correct empty array files field', async (t) => {
  const { knex, fakePGGranules } = t.context;

  const response = await request(app)
    .get(`/granules/${t.context.fakePGGranules[1].granule_id}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const pgGranule = await granulePgModel.get(knex, {
    granule_id: fakePGGranules[1].granule_id,
    collection_cumulus_id: fakePGGranules[1].collection_cumulus_id,
  });

  const expectedGranule = await translatePostgresGranuleToApiGranule({
    granulePgRecord: pgGranule,
    knexOrTransaction: knex,
  });

  t.deepEqual(response.body.files, []);
  t.deepEqual(expectedGranule.files, []);
});

test.serial('GET returns a 400 response if the collectionId is in the wrong format', async (t) => {
  const response = await request(app)
    .get(`/granules/unknownCollection/${t.context.fakePGGranules[2].granule_id}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(400);

  t.is(response.status, 400);
  const { message } = response.body;
  t.is(message, 'invalid collectionId: "unknownCollection"');
});

test.serial("GET returns a 404 response if the granule's collection is not found", async (t) => {
  const response = await request(app)
    .get(`/granules/unknown___unknown/${t.context.fakePGGranules[2].granule_id}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(404);

  t.is(response.status, 404);
  const { message } = response.body;
  t.is(
    message,
    `No collection found for granuleId ${t.context.fakePGGranules[2].granule_id} with collectionId unknown___unknown`
  );
});

test.serial('GET returns a 404 response if the granule is not found', async (t) => {
  const response = await request(app)
    .get('/granules/unknownGranule')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(404);

  t.is(response.status, 404);
  const { message } = response.body;
  t.is(message, 'Granule not found');
});

// TODO postgres query doesn't return searchContext
test.serial.skip('default paginates correctly with search_after', async (t) => {
  const response = await request(app)
    .get('/granules?limit=1')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const granuleIds = t.context.fakePGGranules.map((i) => i.granule_id);

  const { meta, results } = response.body;
  t.is(results.length, 1);
  t.is(meta.page, 1);
  t.truthy(meta.searchContext);

  const newResponse = await request(app)
    .get(`/granules?limit=1&page=2&searchContext=${meta.searchContext}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const { meta: newMeta, results: newResults } = newResponse.body;
  t.is(newResults.length, 1);
  t.is(newMeta.page, 2);
  t.truthy(newMeta.searchContext);
  console.log(`default paginates granuleIds: ${JSON.stringify(granuleIds)}, results: ${results[0].granuleId}, ${newResults[0].granuleId}`);
  t.true(granuleIds.includes(results[0].granuleId));
  t.true(granuleIds.includes(newResults[0].granuleId));
  t.not(results[0].granuleId, newResults[0].granuleId);
  t.not(meta.searchContext === newMeta.searchContext);
});

test.only('LIST endpoint returns search result correctly', async (t) => {
  const granuleIds = t.context.fakePGGranules.map((i) => i.granule_id);
  const searchParams = new URLSearchParams({
    granuleId: granuleIds[3],
  });
  const response = await request(app)
    .get(`/granules?limit=1&page=2&${searchParams}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const { meta, results } = response.body;
  t.is(meta.count, 2);
  t.is(results.length, 1);
  t.true([granuleIds[2], granuleIds[3]].includes(results[0].granuleId));

  const newSearchParams = new URLSearchParams({
    collectionId: t.context.collectionId,
    status: 'failed',
    duration: 52.235,
    timestamp: t.context.fakePGGranules[0].timestamp.getTime(),
  });
  const newResponse = await request(app)
    .get(`/granules?${newSearchParams}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const { meta: newMeta, results: newResults } = newResponse.body;
  t.is(newMeta.count, 2);
  t.is(newResults.length, 2);
  const newResultIds = newResults.map((g) => g.granuleId);
  t.deepEqual([granuleIds[1], granuleIds[2]].sort(), newResultIds.sort());
});
