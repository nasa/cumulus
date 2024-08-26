'use strict';

const fs = require('fs');
const path = require('path');
const sinon = require('sinon');
const test = require('ava');
const omit = require('lodash/omit');

const sortBy = require('lodash/sortBy');
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
  FilePgModel,
  generateLocalTestDb,
  getUniqueGranuleByGranuleId,
  GranulePgModel,
  GranulesExecutionsPgModel,
  localStackConnectionEnv,
  migrationDir,
  PdrPgModel,
  ProviderPgModel,
  translateApiExecutionToPostgresExecution,
  translateApiFiletoPostgresFile,
  translateApiGranuleToPostgresGranule,
  translatePostgresFileToApiFile,
  translatePostgresGranuleToApiGranule,
  upsertGranuleWithExecutionJoinRecord,
} = require('@cumulus/db');

const { createTestIndex, cleanupTestIndex } = require('@cumulus/es-client/testUtils');
const {
  buildS3Uri,
  createBucket,
  createS3Buckets,
  deleteS3Buckets,
  recursivelyDeleteS3Bucket,
  s3ObjectExists,
  s3PutObject,
} = require('@cumulus/aws-client/S3');
const { createSnsTopic } = require('@cumulus/aws-client/SNS');
const { secretsManager, sfn, s3, sns, sqs } = require('@cumulus/aws-client/services');
const {
  SubscribeCommand,
  DeleteTopicCommand,
} = require('@aws-sdk/client-sns');
const { CMR } = require('@cumulus/cmr-client');
const { metadataObjectFromCMRFile } = require('@cumulus/cmrjs/cmr-utils');
const indexer = require('@cumulus/es-client/indexer');
const { Search, multipleRecordFoundString } = require('@cumulus/es-client/search');
const launchpad = require('@cumulus/launchpad-auth');
const { randomString, randomId } = require('@cumulus/common/test-utils');
const { removeNilProperties } = require('@cumulus/common/util');

const { getBucketsConfigKey } = require('@cumulus/common/stack');
const { getDistributionBucketMapKey } = require('@cumulus/distribution-utils');
const { constructCollectionId } = require('@cumulus/message/Collections');

const { create, del, patch, patchGranule } = require('../../endpoints/granules');
const { sortFilesByKey } = require('../helpers/sort');
const assertions = require('../../lib/assertions');
const { createGranuleAndFiles } = require('../helpers/create-test-data');
const models = require('../../models');

const { request } = require('../helpers/request');

const { version } = require('../../lib/version');

// Dynamo mock data factories
const {
  createFakeJwtAuthToken,
  fakeAccessTokenFactory,
  fakeGranuleFactoryV2,
  setAuthorizedOAuthUsers,
  fakeExecutionFactoryV2,
} = require('../../lib/testUtils');
const { createJwtToken } = require('../../lib/token');

const {
  generateMoveGranuleTestFilesAndEntries,
  getFileNameFromKey,
  getPgFilesFromGranuleCumulusId,
} = require('./granules/helpers');
const { buildFakeExpressResponse } = require('./utils');

const testDbName = `granules_${cryptoRandomString({ length: 10 })}`;

let accessTokenModel;
let executionPgModel;
let filePgModel;
let granulePgModel;
let granulesExecutionsPgModel;
let jwtAuthToken;

process.env.AccessTokensTable = randomId('token');
process.env.stackName = randomId('stackname');
process.env.system_bucket = randomId('system-bucket');
process.env.TOKEN_SECRET = randomId('secret');
process.env.backgroundQueueUrl = randomId('backgroundQueueUrl');

// import the express app after setting the env variables
const { app } = require('../../app');

async function runTestUsingBuckets(buckets, testFunction) {
  try {
    await createS3Buckets(buckets);
    await testFunction();
  } finally {
    await Promise.all(buckets.map(recursivelyDeleteS3Bucket));
  }
}

/**
 * Helper for creating and uploading bucket configuration for 'move' tests.
 * @returns {Object} with keys of internalBucket, and publicBucket.
 */
async function setupBucketsConfig() {
  const systemBucket = process.env.system_bucket;
  const buckets = {
    protected: {
      name: systemBucket,
      type: 'protected',
    },
    public: {
      name: randomId('public'),
      type: 'public',
    },
  };

  process.env.DISTRIBUTION_ENDPOINT = 'http://example.com/';
  await s3PutObject({
    Bucket: systemBucket,
    Key: getBucketsConfigKey(process.env.stackName),
    Body: JSON.stringify(buckets),
  });
  await createBucket(buckets.public.name);
  // Create the required bucket map configuration file
  await s3PutObject({
    Bucket: systemBucket,
    Key: getDistributionBucketMapKey(process.env.stackName),
    Body: JSON.stringify({
      [systemBucket]: systemBucket,
      [buckets.public.name]: buckets.public.name,
    }),
  });
  return { internalBucket: systemBucket, publicBucket: buckets.public.name };
}

test.before(async (t) => {
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
  filePgModel = new FilePgModel();
  granulesExecutionsPgModel = new GranulesExecutionsPgModel();

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

  const { esIndex, esClient } = await createTestIndex();
  t.context.esIndex = esIndex;
  t.context.esClient = esClient;

  t.context.esGranulesClient = new Search({}, 'granule', process.env.ES_INDEX);

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
        granulePgModel: t.context.granulePgModel,
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
  await cleanupTestIndex(t.context);
});


test.serial('default lists and paginates correctly with search_after', async (t) => {
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

test.serial('default paginates correctly with search_after', async (t) => {
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
  t.true(granuleIds.includes(results[0].granuleId));
  t.true(granuleIds.includes(newResults[0].granuleId));
  t.not(results[0].granuleId, newResults[0].granuleId);
  t.not(meta.searchContext === newMeta.searchContext);
});