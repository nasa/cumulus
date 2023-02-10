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

const {
  createTestIndex,
  cleanupTestIndex,
} = require('@cumulus/es-client/testUtils');

const {
  buildS3Uri,
  createBucket,
  createS3Buckets,
  deleteS3Buckets,
  recursivelyDeleteS3Bucket,
  s3ObjectExists,
  s3PutObject,
} = require('@cumulus/aws-client/S3');

const {
  secretsManager,
  sfn,
  s3,
  sns,
  sqs,
} = require('@cumulus/aws-client/services');
const { CMR } = require('@cumulus/cmr-client');
const {
  metadataObjectFromCMRFile,
} = require('@cumulus/cmrjs/cmr-utils');
const indexer = require('@cumulus/es-client/indexer');
const { Search } = require('@cumulus/es-client/search');
const launchpad = require('@cumulus/launchpad-auth');
const { randomString, randomId } = require('@cumulus/common/test-utils');
const { removeNilProperties } = require('@cumulus/common/util');

const { getBucketsConfigKey } = require('@cumulus/common/stack');
const { getDistributionBucketMapKey } = require('@cumulus/distribution-utils');
const { constructCollectionId } = require('@cumulus/message/Collections');

const { create, patch, patchGranule } = require('../../endpoints/granules');
const assertions = require('../../lib/assertions');
const { createGranuleAndFiles } = require('../helpers/create-test-data');
const { sortFilesByKey } = require('../helpers/sort');
const models = require('../../models');

const { request } = require('../helpers/request');
const supertest = require('supertest');

// Dynamo mock data factories
const {
  createFakeJwtAuthToken,
  fakeAccessTokenFactory,
  fakeCollectionFactory,
  fakeGranuleFactoryV2,
  setAuthorizedOAuthUsers,
  fakeExecutionFactoryV2,
} = require('../../lib/testUtils');
const {
  createJwtToken,
} = require('../../lib/token');

const {
  generateMoveGranuleTestFilesAndEntries,
  getFileNameFromKey,
  getPgFilesFromGranuleCumulusId,
} = require('./granules/helpers');
const { buildFakeExpressResponse } = require('./utils');

const testDbName = `granules_${cryptoRandomString({ length: 10 })}`;

let accessTokenModel;
let collectionModel;
let executionModel;
let executionPgModel;
let filePgModel;
let granuleModel;
let granulePgModel;
let granulesExecutionsPgModel;
let jwtAuthToken;

process.env.AccessTokensTable = randomId('token');
process.env.AsyncOperationsTable = randomId('async');
process.env.ExecutionsTable = randomId('executions');
process.env.CollectionsTable = randomId('collection');
process.env.GranulesTable = randomId('granules');
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

  // create a fake bucket
  await createBucket(process.env.system_bucket);

  // create a workflow template file
  const tKey = `${process.env.stackName}/workflow_template.json`;
  await s3PutObject({ Bucket: process.env.system_bucket, Key: tKey, Body: '{}' });

  // create fake Collections table
  collectionModel = new models.Collection();
  await collectionModel.createTable();

  // create fake execution table
  executionModel = new models.Execution();
  await executionModel.createTable();
  executionPgModel = new ExecutionPgModel();

  // create fake Granules table
  granuleModel = new models.Granule();
  await granuleModel.createTable();
  t.context.granuleModel = granuleModel;

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
  await secretsManager().createSecret({
    Name: process.env.cmr_password_secret_name,
    SecretString: randomString(),
  }).promise();

  // Store the Launchpad passphrase
  process.env.launchpad_passphrase_secret_name = randomString();
  await secretsManager().createSecret({
    Name: process.env.launchpad_passphrase_secret_name,
    SecretString: randomString(),
  }).promise();

  // Generate a local test postGres database

  const { knex, knexAdmin } = await generateLocalTestDb(testDbName, migrationDir);
  t.context.knex = knex;
  t.context.knexAdmin = knexAdmin;

  const { esIndex, esClient } = await createTestIndex();
  t.context.esIndex = esIndex;
  t.context.esClient = esClient;

  t.context.esGranulesClient = new Search(
    {},
    'granule',
    process.env.ES_INDEX
  );

  // Create collections in Dynamo and Postgres
  // we need this because a granule has a foreign key referring to collections
  t.context.collectionName = 'fakeCollection';
  t.context.collectionVersion = 'v1';

  t.context.testCollection = fakeCollectionFactory({
    name: t.context.collectionName,
    version: t.context.collectionVersion,
    duplicateHandling: 'error',
  });
  t.context.collectionId = constructCollectionId(
    t.context.collectionName,
    t.context.collectionVersion
  );

  const testPgCollection = fakeCollectionRecordFactory({
    name: t.context.collectionName,
    version: t.context.collectionVersion,
  });
  t.context.collectionPgModel = new CollectionPgModel();
  const [pgCollection] = await t.context.collectionPgModel.create(
    t.context.knex,
    testPgCollection
  );

  t.context.providerPgModel = new ProviderPgModel();
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
  const [testExecution] = (
    await executionPgModel.create(t.context.knex, t.context.testExecution)
  );
  t.context.testExecutionCumulusId = testExecution.cumulus_id;
  t.context.collectionCumulusId = pgCollection.cumulus_id;

  const newExecution = fakeExecutionFactoryV2({
    arn: 'arn3',
    status: 'completed',
    name: 'test_execution',
    parentArn: undefined,
  });

  await executionModel.create(newExecution);
  const executionPgRecord = await translateApiExecutionToPostgresExecution(
    newExecution,
    knex
  );
  [t.context.executionPgRecord] = await executionPgModel.create(knex, executionPgRecord);
  t.context.executionUrl = executionPgRecord.url;
  t.context.executionArn = executionPgRecord.arn;
});

test.beforeEach(async (t) => {
  t.context.createGranuleId = () => `${cryptoRandomString({ length: 7 })}.${cryptoRandomString({ length: 20 })}.hdf`;
  const granuleId1 = t.context.createGranuleId();
  const granuleId2 = t.context.createGranuleId();

  // create fake Dynamo granule records
  t.context.fakeGranules = [
    fakeGranuleFactoryV2({
      granuleId: granuleId1,
      status: 'completed',
      execution: t.context.executionUrl,
      duration: 47.125,
    }),
    fakeGranuleFactoryV2({
      granuleId: granuleId2,
      status: 'failed',
      execution: t.context.executionUrl,
      duration: 52.235,
    }),
  ];

  await Promise.all(t.context.fakeGranules.map((granule) =>
    granuleModel.create(granule)
      .then((record) => indexer.indexGranule(t.context.esClient, record, t.context.esIndex))));

  // create fake Postgres granule records
  t.context.fakePGGranules = [
    fakeGranuleRecordFactory(
      {
        granule_id: granuleId1,
        status: 'completed',
        collection_cumulus_id: t.context.collectionCumulusId,
        published: true,
        cmr_link: 'https://cmr.uat.earthdata.nasa.gov/search/granules.json?concept_id=A123456789-TEST_A',
        duration: 47.125,
        timestamp: new Date(Date.now()),
      }
    ),
    fakeGranuleRecordFactory(
      {
        granule_id: granuleId2,
        status: 'failed',
        collection_cumulus_id: t.context.collectionCumulusId,
        duration: 52.235,
        timestamp: new Date(Date.now()),
      }
    ),
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
  await granuleModel.deleteTable();
  await executionModel.deleteTable();
  await accessTokenModel.deleteTable();
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
  await secretsManager().deleteSecret({
    SecretId: process.env.cmr_password_secret_name,
    ForceDeleteWithoutRecovery: true,
  }).promise();
  await secretsManager().deleteSecret({
    SecretId: process.env.launchpad_passphrase_secret_name,
    ForceDeleteWithoutRecovery: true,
  }).promise();

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
  t.is(results.length, 2);
  t.is(meta.stack, process.env.stackName);
  t.is(meta.table, 'granule');
  t.is(meta.count, 2);

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

test.serial('CUMULUS-911 GET with pathParameters.granuleName set and without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .get('/granules/asdf')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test.serial('CUMULUS-911 .patch with pathParameters.granuleName set and without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .patch('/granules/asdf')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test.serial('CUMULUS-911 DELETE with pathParameters.granuleName set and without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .delete('/granules/asdf')
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

test.serial('CUMULUS-912 GET with pathParameters.granuleName set and with an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(app)
    .get('/granules/asdf')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(401);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test.todo('CUMULUS-912 GET with pathParameters.granuleName set and with an unauthorized user returns an unauthorized response');

test.serial('CUMULUS-912 PUT with pathParameters.granuleName set and with an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(app)
    .patch('/granules/asdf')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(401);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test.todo('CUMULUS-912 PUT with pathParameters.granuleName set and with an unauthorized user returns an unauthorized response');

test.serial('CUMULUS-912 DELETE with pathParameters.granuleName set and with an unauthorized user returns an unauthorized response', async (t) => {
  const accessTokenRecord = fakeAccessTokenFactory();
  await accessTokenModel.create(accessTokenRecord);
  const jwtToken = createJwtToken(accessTokenRecord);

  const response = await request(app)
    .delete('/granules/adsf')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtToken}`)
    .expect(401);

  assertions.isUnauthorizedUserResponse(t, response);
});

test.serial('GET returns the expected existing granule', async (t) => {
  const {
    knex,
    fakePGGranules,
  } = t.context;

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

test.serial('GET returns a granule that has no files with the correct empty array files field', async (t) => {
  const {
    knex,
    fakePGGranules,
  } = t.context;

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

test.serial('PATCH fails if action is not supported', async (t) => {
  const response = await request(app)
    .patch(`/granules/${t.context.fakePGGranules[0].granule_id}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send({ action: 'someUnsupportedAction' })
    .expect(400);

  t.is(response.status, 400);
  const { message } = response.body;
  t.true(message.includes('Action is not supported'));
});

test.serial('PATCH without a body, fails to update granule.', async (t) => {
  const response = await request(app)
    .patch(`/granules/${t.context.fakePGGranules[0].granule_id}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(400);

  t.is(response.status, 400);
  const { message } = response.body;
  t.is(message, `input :granuleName (${t.context.fakeGranules[0].granuleId}) must match body's granuleId (undefined)`);
});

// This needs to be serial because it is stubbing aws.sfn's responses
test.serial('reingest a granule', async (t) => {
  const fakeDescribeExecutionResult = {
    input: JSON.stringify({
      meta: {
        workflow_name: 'IngestGranule',
      },
      payload: {},
    }),
  };

  // fake workflow
  const message = JSON.parse(fakeDescribeExecutionResult.input);
  const wKey = `${process.env.stackName}/workflows/${message.meta.workflow_name}.json`;
  await s3PutObject({ Bucket: process.env.system_bucket, Key: wKey, Body: '{}' });

  const stub = sinon.stub(sfn(), 'describeExecution').returns({
    promise: () => Promise.resolve(fakeDescribeExecutionResult),
  });
  t.teardown(() => stub.restore());
  const response = await request(app)
    .patch(`/granules/${t.context.fakePGGranules[0].granule_id}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send({ action: 'reingest' })
    .expect(200);

  const body = response.body;
  t.is(body.status, 'SUCCESS');
  t.is(body.action, 'reingest');
  t.true(body.warning.includes('overwritten'));

  const updatedPgGranule = await getUniqueGranuleByGranuleId(
    t.context.knex,
    t.context.fakePGGranules[0].granule_id
  );
  const updatedDynamoGranule = await granuleModel.get(
    { granuleId: t.context.fakeGranules[0].granuleId }
  );

  t.is(updatedPgGranule.status, 'queued');
  t.is(updatedDynamoGranule.status, 'queued');
});

// This needs to be serial because it is stubbing aws.sfn's responses
test.serial('apply an in-place workflow to an existing granule', async (t) => {
  const fakeSFResponse = {
    execution: {
      input: JSON.stringify({
        meta: {
          workflow_name: 'inPlaceWorkflow',
        },
        payload: {},
      }),
    },
  };

  //fake in-place workflow
  const message = JSON.parse(fakeSFResponse.execution.input);
  const wKey = `${process.env.stackName}/workflows/${message.meta.workflow_name}.json`;
  await s3PutObject({ Bucket: process.env.system_bucket, Key: wKey, Body: '{}' });

  const fakeDescribeExecutionResult = {
    output: JSON.stringify({
      meta: {
        workflow_name: 'IngestGranule',
      },
      payload: {},
    }),
  };

  const stub = sinon.stub(sfn(), 'describeExecution').returns({
    promise: () => Promise.resolve(fakeDescribeExecutionResult),
  });
  t.teardown(() => stub.restore());

  const response = await request(app)
    .patch(`/granules/${t.context.fakePGGranules[0].granule_id}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send({
      action: 'applyWorkflow',
      workflow: 'inPlaceWorkflow',
      messageSource: 'output',
    })
    .expect(200);

  const body = response.body;
  t.is(body.status, 'SUCCESS');
  t.is(body.action, 'applyWorkflow inPlaceWorkflow');

  const updatedPgGranule = await getUniqueGranuleByGranuleId(
    t.context.knex,
    t.context.fakePGGranules[0].granule_id
  );
  const updatedDynamoGranule = await granuleModel.get(
    { granuleId: t.context.fakeGranules[0].granuleId }
  );

  t.is(updatedPgGranule.status, 'queued');
  t.is(updatedDynamoGranule.status, 'queued');
});

test.serial('remove a granule from CMR', async (t) => {
  const {
    s3Buckets,
    newPgGranule,
  } = await createGranuleAndFiles({
    dbClient: t.context.knex,
    esClient: t.context.esClient,
    granuleParams: { published: true },
  });

  const granuleId = newPgGranule.granule_id;

  sinon.stub(
    CMR.prototype,
    'deleteGranule'
  ).callsFake(() => Promise.resolve());

  sinon.stub(
    CMR.prototype,
    'getGranuleMetadata'
  ).callsFake(() => Promise.resolve({ title: granuleId }));

  try {
    const response = await request(app)
      .patch(`/granules/${granuleId}`)
      .set('Accept', 'application/json')
      .set('Authorization', `Bearer ${jwtAuthToken}`)
      .send({ action: 'removeFromCmr' })
      .expect(200);

    const body = response.body;
    t.is(body.status, 'SUCCESS');
    t.is(body.action, 'removeFromCmr');

    // Should have updated the Dynamo granule
    const updatedDynamoGranule = await granuleModel.get({ granuleId });
    t.is(updatedDynamoGranule.published, false);
    t.is(updatedDynamoGranule.cmrLink, undefined);

    // Should have updated the Postgres granule
    const updatedPgGranule = await getUniqueGranuleByGranuleId(
      t.context.knex,
      granuleId
    );
    t.is(updatedPgGranule.published, false);
    t.is(updatedPgGranule.cmrLink, undefined);
  } finally {
    CMR.prototype.deleteGranule.restore();
    CMR.prototype.getGranuleMetadata.restore();
  }

  t.teardown(() => deleteS3Buckets([
    s3Buckets.protected.name,
    s3Buckets.public.name,
  ]));
});

test.serial('remove a granule from CMR with launchpad authentication', async (t) => {
  process.env.cmr_oauth_provider = 'launchpad';
  const launchpadStub = sinon.stub(launchpad, 'getLaunchpadToken').callsFake(() => randomString());

  sinon.stub(
    CMR.prototype,
    'deleteGranule'
  ).callsFake(() => Promise.resolve());

  sinon.stub(
    CMR.prototype,
    'getGranuleMetadata'
  ).callsFake(() => Promise.resolve({ title: t.context.fakePGGranules[0].granule_id }));

  try {
    const response = await request(app)
      .patch(`/granules/${t.context.fakePGGranules[0].granule_id}`)
      .set('Accept', 'application/json')
      .set('Authorization', `Bearer ${jwtAuthToken}`)
      .send({ action: 'removeFromCmr' })
      .expect(200);

    const body = response.body;
    t.is(body.status, 'SUCCESS');
    t.is(body.action, 'removeFromCmr');

    const updatedGranule = await granuleModel.get({
      granuleId: t.context.fakePGGranules[0].granule_id,
    });
    t.is(updatedGranule.published, false);
    t.is(updatedGranule.cmrLink, undefined);

    t.is(launchpadStub.calledOnce, true);
  } finally {
    process.env.cmr_oauth_provider = 'earthdata';
    launchpadStub.restore();
    CMR.prototype.deleteGranule.restore();
    CMR.prototype.getGranuleMetadata.restore();
  }
});

test.serial('DELETE returns 404 if granule does not exist', async (t) => {
  const granuleId = randomString();
  const response = await request(app)
    .delete(`/granules/${granuleId}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(404);
  t.true(response.body.message.includes('No record found'));
});

test.serial('DELETE deletes a granule that exists in PostgreSQL but not Elasticsearch successfully', async (t) => {
  const {
    collectionPgModel,
    esGranulesClient,
    knex,
  } = t.context;
  const testPgCollection = fakeCollectionRecordFactory({
    name: randomString(),
    version: '005',
  });
  const newCollectionId = constructCollectionId(
    testPgCollection.name,
    testPgCollection.version
  );

  await collectionPgModel.create(
    knex,
    testPgCollection
  );
  const newGranule = fakeGranuleFactoryV2(
    {
      granuleId: randomId(),
      status: 'failed',
      collectionId: newCollectionId,
      published: false,
      files: [],
    }
  );
  await granuleModel.create(newGranule);
  const newPgGranule = await translateApiGranuleToPostgresGranule({
    dynamoRecord: newGranule,
    knexOrTransaction: knex,
  });
  const [createdPgGranule] = await granulePgModel.create(knex, newPgGranule);

  t.true(await granulePgModel.exists(
    knex,
    {
      granule_id: createdPgGranule.granule_id,
      collection_cumulus_id: createdPgGranule.collection_cumulus_id,
    }
  ));
  t.false(await esGranulesClient.exists(newGranule.granuleId));

  const response = await request(app)
    .delete(`/granules/${newGranule.granuleId}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  t.is(response.status, 200);
  const responseBody = response.body;
  t.like(responseBody, {
    detail: 'Record deleted',
    collection: newCollectionId,
    deletedGranuleId: newGranule.granuleId,
  });
  t.truthy(responseBody.deletionTime);
  t.is(responseBody.deletedFiles.length, newGranule.files.length);

  t.false(await granulePgModel.exists(
    knex,
    {
      granule_id: createdPgGranule.granule_id,
      collection_cumulus_id: createdPgGranule.collection_cumulus_id,
    }
  ));
});

test.serial('DELETE deletes a granule that exists in Elasticsearch but not PostgreSQL successfully', async (t) => {
  const {
    collectionPgModel,
    esClient,
    esIndex,
    esGranulesClient,
    knex,
  } = t.context;
  const testPgCollection = fakeCollectionRecordFactory({
    name: randomString(),
    version: '005',
  });
  const newCollectionId = constructCollectionId(
    testPgCollection.name,
    testPgCollection.version
  );

  const [pgCollection] = await collectionPgModel.create(
    knex,
    testPgCollection
  );
  const newGranule = fakeGranuleFactoryV2(
    {
      granuleId: randomId(),
      status: 'failed',
      collectionId: newCollectionId,
      published: false,
      files: [],
    }
  );
  await granuleModel.create(newGranule);
  await indexer.indexGranule(esClient, newGranule, esIndex);
  t.false(await granulePgModel.exists(
    knex,
    {
      granule_id: newGranule.granuleId,
      collection_cumulus_id: pgCollection.cumulus_id,
    }
  ));
  t.true(await esGranulesClient.exists(newGranule.granuleId));

  const response = await request(app)
    .delete(`/granules/${newGranule.granuleId}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  t.is(response.status, 200);
  const responseBody = response.body;
  t.like(responseBody, {
    detail: 'Record deleted',
    collection: newCollectionId,
    deletedGranuleId: newGranule.granuleId,
  });
  t.truthy(responseBody.deletionTime);
  t.is(responseBody.deletedFiles.length, newGranule.files.length);

  t.false(await esGranulesClient.exists(newGranule.granuleId));
});

test.serial('DELETE deleting an existing granule that is published will fail and not delete records', async (t) => {
  const {
    s3Buckets,
    newDynamoGranule,
    newPgGranule: { collection_cumulus_id: collectionCumulusId },
  } = await createGranuleAndFiles({
    dbClient: t.context.knex,
    granuleParams: { published: true },
    esClient: t.context.esClient,
  });

  const granuleId = newDynamoGranule.granuleId;

  const response = await request(app)
    .delete(`/granules/${granuleId}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(400);

  t.is(response.status, 400);
  const { message } = response.body;
  t.is(
    message,
    'You cannot delete a granule that is published to CMR. Remove it from CMR first'
  );

  // granule should still exist in Dynamo and Postgres
  t.true(await granulePgModel.exists(
    t.context.knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  ));
  t.true(await granuleModel.exists({ granuleId }));

  // Verify files still exist in S3 and Postgres
  await Promise.all(
    newDynamoGranule.files.map(async (file) => {
      t.true(await s3ObjectExists({ Bucket: file.bucket, Key: file.key }));
      t.true(await filePgModel.exists(t.context.knex, { bucket: file.bucket, key: file.key }));
    })
  );

  t.teardown(() => deleteS3Buckets([
    s3Buckets.protected.name,
    s3Buckets.public.name,
  ]));
});

test.serial('DELETE deleting an existing unpublished granule succeeds', async (t) => {
  const {
    s3Buckets,
    newDynamoGranule,
    newPgGranule: { collection_cumulus_id: collectionCumulusId },
  } = await createGranuleAndFiles({
    dbClient: t.context.knex,
    granuleParams: { published: false },
    esClient: t.context.esClient,
  });

  const granuleId = newDynamoGranule.granuleId;

  const response = await request(app)
    .delete(`/granules/${newDynamoGranule.granuleId}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  t.is(response.status, 200);
  const responseBody = response.body;
  t.like(responseBody, {
    detail: 'Record deleted',
    collection: newDynamoGranule.collectionId,
    deletedGranuleId: granuleId,
  });
  t.truthy(responseBody.deletionTime);
  t.is(responseBody.deletedFiles.length, newDynamoGranule.files.length);

  // granule have been deleted from Postgres and Dynamo
  t.false(await granulePgModel.exists(
    t.context.knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  ));
  t.false(await granuleModel.exists({ granuleId }));

  // verify the files are deleted from S3 and Postgres
  await Promise.all(
    newDynamoGranule.files.map(async (file) => {
      t.false(await s3ObjectExists({ Bucket: file.bucket, Key: file.key }));
      t.false(await filePgModel.exists(t.context.knex, { bucket: file.bucket, key: file.key }));
    })
  );

  t.teardown(() => deleteS3Buckets([
    s3Buckets.protected.name,
    s3Buckets.public.name,
  ]));
});

test.serial('DELETE throws an error if the Postgres get query fails', async (t) => {
  const {
    s3Buckets,
    newDynamoGranule,
    newPgGranule: { collection_cumulus_id: collectionCumulusId },
  } = await createGranuleAndFiles({
    dbClient: t.context.knex,
    granuleParams: { published: true },
    esClient: t.context.esClient,
  });

  sinon
    .stub(GranulePgModel.prototype, 'get')
    .throws(new Error('Error message'));

  try {
    const response = await request(app)
      .delete(`/granules/${newDynamoGranule.granuleId}`)
      .set('Accept', 'application/json')
      .set('Authorization', `Bearer ${jwtAuthToken}`);
    t.is(response.status, 400);
  } finally {
    GranulePgModel.prototype.get.restore();
  }

  const granuleId = newDynamoGranule.granuleId;

  // granule not have been deleted from Postgres or Dynamo
  t.true(await granulePgModel.exists(
    t.context.knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  ));
  t.true(await granuleModel.exists({ granuleId }));

  // verify the files still exist in S3 and Postgres
  await Promise.all(
    newDynamoGranule.files.map(async (file) => {
      t.true(await s3ObjectExists({ Bucket: file.bucket, Key: file.key }));
      t.true(await filePgModel.exists(t.context.knex, { bucket: file.bucket, key: file.key }));
    })
  );

  t.teardown(() => deleteS3Buckets([
    s3Buckets.protected.name,
    s3Buckets.public.name,
  ]));
});

test.serial('DELETE publishes an SNS message after a successful granule delete', async (t) => {
  const {
    s3Buckets,
    newDynamoGranule,
    newPgGranule,
  } = await createGranuleAndFiles({
    dbClient: t.context.knex,
    granuleParams: { published: false },
    esClient: t.context.esClient,
  });
  const timeOfResponse = Date.now();
  const granuleId = newDynamoGranule.granuleId;

  const response = await request(app)
    .delete(`/granules/${newDynamoGranule.granuleId}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  t.is(response.status, 200);
  const responseBody = response.body;
  t.like(responseBody, {
    detail: 'Record deleted',
    collection: newDynamoGranule.collectionId,
    deletedGranuleId: granuleId,
  });
  t.truthy(responseBody.deletionTime);
  t.is(responseBody.deletedFiles.length, newDynamoGranule.files.length);

  // granule have been deleted from Postgres and Dynamo
  t.false(await granulePgModel.exists(
    t.context.knex,
    {
      granule_id: granuleId,
      collection_cumulus_id: newPgGranule.collection_cumulus_id,
    }
  ));
  t.false(await granuleModel.exists({ granuleId }));

  // verify the files are deleted from S3 and Postgres
  await Promise.all(
    newDynamoGranule.files.map(async (file) => {
      t.false(await s3ObjectExists({ Bucket: file.bucket, Key: file.key }));
      t.false(await filePgModel.exists(t.context.knex, { bucket: file.bucket, key: file.key }));
    })
  );

  t.teardown(() => deleteS3Buckets([
    s3Buckets.protected.name,
    s3Buckets.public.name,
  ]));
  const { Messages } = await sqs().receiveMessage({
    QueueUrl: t.context.QueueUrl,
    WaitTimeSeconds: 10,
  }).promise();
  const snsMessageBody = JSON.parse(Messages[0].Body);
  const publishedMessage = JSON.parse(snsMessageBody.Message);

  t.is(publishedMessage.record.granuleId, newDynamoGranule.granuleId);
  t.is(publishedMessage.event, 'Delete');
  t.true(publishedMessage.deletedAt > timeOfResponse);
  t.true(publishedMessage.deletedAt < Date.now());
});

test.serial('move a granule with no .cmr.xml file', async (t) => {
  const bucket = process.env.system_bucket;
  const secondBucket = randomId('second');
  const thirdBucket = randomId('third');

  const {
    esGranulesClient,
  } = t.context;

  await runTestUsingBuckets(
    [secondBucket, thirdBucket],
    async () => {
      // Generate Granule/Files, S3 objects and database entries
      const granuleFileName = randomId('granuleFileName');
      const {
        newGranule,
        postgresGranuleCumulusId,
      } = await generateMoveGranuleTestFilesAndEntries({
        t,
        bucket,
        secondBucket,
        granulePgModel,
        filePgModel,
        granuleModel,
        granuleFileName,
      });

      const destinationFilepath = `${process.env.stackName}/granules_moved`;
      const destinations = [
        {
          regex: '.*.txt$',
          bucket,
          filepath: destinationFilepath,
        },
        {
          regex: '.*.md$',
          bucket: thirdBucket,
          filepath: destinationFilepath,
        },
        {
          regex: '.*.jpg$',
          bucket,
          filepath: destinationFilepath,
        },
      ];

      const response = await request(app)
        .patch(`/granules/${newGranule.granuleId}`)
        .set('Accept', 'application/json')
        .set('Authorization', `Bearer ${jwtAuthToken}`)
        .send({
          action: 'move',
          destinations,
        })
        .expect(200);

      const body = response.body;
      t.is(body.status, 'SUCCESS');
      t.is(body.action, 'move');

      // Validate S3 Objects are where they should be
      const bucketObjects = await s3().listObjects({
        Bucket: bucket,
        Prefix: destinationFilepath,
      });

      t.is(bucketObjects.Contents.length, 2);
      bucketObjects.Contents.forEach((item) => {
        t.is(item.Key.indexOf(`${destinationFilepath}/${granuleFileName}`), 0);
      });

      const thirdBucketObjects = await s3().listObjects({
        Bucket: thirdBucket,
        Prefix: destinationFilepath,
      });

      t.is(thirdBucketObjects.Contents.length, 1);
      t.is(thirdBucketObjects.Contents[0].Key, `${destinationFilepath}/${granuleFileName}.md`);

      // check the granule in dynamoDb is updated and files are replaced
      const updatedGranule = await granuleModel.get({ granuleId: newGranule.granuleId });

      updatedGranule.files.forEach((file) => {
        t.true(file.key.startsWith(`${destinationFilepath}/${granuleFileName}`));
        const destination = destinations.find((dest) => file.fileName.match(dest.regex));
        t.is(destination.bucket, file.bucket);
      });

      // check the granule in postgres is updated
      const pgFiles = await getPgFilesFromGranuleCumulusId(
        t.context.knex,
        filePgModel,
        postgresGranuleCumulusId
      );

      t.is(pgFiles.length, 3);

      for (let i = 0; i < pgFiles.length; i += 1) {
        const destination = destinations.find((dest) => pgFiles[i].file_name.match(dest.regex));
        const fileName = pgFiles[i].file_name;

        t.is(destination.bucket, pgFiles[i].bucket);
        t.like(pgFiles[i], {
          ...omit(newGranule.files[i], ['fileName', 'size', 'createdAt', 'updatedAt']),
          key: `${destinationFilepath}/${fileName}`,
          bucket: destination.bucket,
        });
      }

      // check the ES index is updated
      const esRecord = await esGranulesClient.get(newGranule.granuleId);
      t.is(esRecord.files.length, 3);
      esRecord.files.forEach((esFileRecord) => {
        const pgMatchingFileRecord = pgFiles.find(
          (pgFile) =>
            pgFile.key.match(esFileRecord.key)
            && pgFile.bucket.match(esFileRecord.bucket)
        );
        t.deepEqual(translatePostgresFileToApiFile(pgMatchingFileRecord), esFileRecord);
      });
    }
  );
});

test.serial('When a move granule request fails to move a file correctly, it records the expected granule files in postgres and dynamo', async (t) => {
  const bucket = process.env.system_bucket;
  const secondBucket = randomId('second');
  const thirdBucket = randomId('third');
  const fakeBucket = 'not-a-real-bucket';

  await runTestUsingBuckets(
    [secondBucket, thirdBucket],
    async () => {
      // Generate Granule/Files, S3 objects and database entries
      const granuleFileName = randomId('granuleFileName');
      const {
        newGranule,
        postgresGranuleCumulusId,
      } = await generateMoveGranuleTestFilesAndEntries({
        t,
        bucket,
        secondBucket,
        granulePgModel,
        filePgModel,
        granuleModel,
        granuleFileName,
      });

      // Create 'destination' objects
      const destinationFilepath = `${process.env.stackName}/granules_fail_1`;
      const destinations = [
        {
          regex: '.*.txt$',
          bucket,
          filepath: destinationFilepath,
        },
        {
          regex: '.*.md$',
          bucket: thirdBucket,
          filepath: destinationFilepath,
        },
        {
          regex: '.*.jpg$',
          bucket: fakeBucket,
          filepath: destinationFilepath,
        },
      ];

      const response = await request(app)
        .patch(`/granules/${newGranule.granuleId}`)
        .set('Accept', 'application/json')
        .set('Authorization', `Bearer ${jwtAuthToken}`)
        .send({
          action: 'move',
          destinations,
        })
        .expect(400);

      const message = JSON.parse(response.body.message);

      message.granule.files = sortBy(message.granule.files, (file) => getFileNameFromKey(file.key));
      newGranule.files = sortBy(newGranule.files, (file) => getFileNameFromKey(file.key));

      const fileWithInvalidDestination = newGranule.files[0];

      t.is(message.reason, 'Failed to move granule');
      t.deepEqual(message.granule, newGranule);
      t.is(message.errors.length, 1);
      t.is(message.errors[0].name, 'NoSuchBucket');

      const actualGranuleFileRecord = sortBy(message.granuleFilesRecords, ['key']);
      const expectedGranuleFileRecord = [
        {
          bucket: thirdBucket,
          key: `${destinationFilepath}/${granuleFileName}.md`,
          fileName: `${granuleFileName}.md`,
          size: 9,
          source: 'fakeSource',
        },
        {
          bucket,
          key: `${destinationFilepath}/${granuleFileName}.txt`,
          fileName: `${granuleFileName}.txt`,
          size: 9,
          source: 'fakeSource',
        },
        {
          bucket: fileWithInvalidDestination.bucket,
          key: fileWithInvalidDestination.key,
          fileName: `${granuleFileName}.jpg`,
          size: 9,
          source: 'fakeSource',
        },
      ];

      t.deepEqual(expectedGranuleFileRecord, actualGranuleFileRecord);

      // Validate S3 Objects are where they should be
      const bucketObjects = await s3().listObjects({
        Bucket: bucket,
        Prefix: destinationFilepath,
      });
      t.is(bucketObjects.Contents.length, 1);
      t.is(bucketObjects.Contents[0].Key, `${destinationFilepath}/${granuleFileName}.txt`);

      const failedBucketObjects = await s3().listObjects({
        Bucket: secondBucket,
        Prefix: `${process.env.stackName}/original_filepath`,
      });
      t.is(failedBucketObjects.Contents.length, 1);
      t.is(failedBucketObjects.Contents[0].Key,
        (`${process.env.stackName}/original_filepath/${granuleFileName}.jpg`));

      const thirdBucketObjects = await s3().listObjects({
        Bucket: thirdBucket,
        Prefix: destinationFilepath,
      });
      t.is(thirdBucketObjects.Contents.length, 1);
      t.is(thirdBucketObjects.Contents[0].Key, `${destinationFilepath}/${granuleFileName}.md`);

      // check the granule in dynamoDb is updated and files are replaced
      const updatedGranule = await granuleModel.get({ granuleId: newGranule.granuleId });

      const updatedFiles = sortBy(updatedGranule.files, (file) => getFileNameFromKey(file.key));
      const granuleFiles = sortBy(newGranule.files, (file) => getFileNameFromKey(file.key));

      t.deepEqual({
        ...fileWithInvalidDestination,
        fileName: `${granuleFileName}.jpg`,
      }, updatedFiles[0]);

      t.true(
        updatedFiles[1].key.startsWith(`${destinationFilepath}/${granuleFileName}`),
        `updatedFile[1] ${updatedFiles[1].key}, did not start with ${destinationFilepath}/${granuleFileName}`
      );
      t.like(newGranule.files[1], omit(updatedFiles[1], ['fileName', 'key', 'bucket']));
      t.is(updatedFiles[1].bucket, destinations.find(
        (dest) => updatedFiles[1].fileName.match(dest.regex)
      ).bucket);

      t.true(
        updatedFiles[2].key.startsWith(`${destinationFilepath}/${granuleFileName}`),
        `updatedFile[2] ${updatedFiles[2].key}, did not start with ${destinationFilepath}/${granuleFileName}`
      );
      t.like(granuleFiles[2], omit(updatedFiles[2], ['fileName', 'key', 'bucket']));
      t.is(updatedFiles[2].bucket, destinations.find(
        (dest) => updatedFiles[2].fileName.match(dest.regex)
      ).bucket);

      // Check that the postgres granules are in the correct state
      const pgFiles = await getPgFilesFromGranuleCumulusId(
        t.context.knex,
        filePgModel,
        postgresGranuleCumulusId
      );

      // Sort by only the filename because the paths will have changed
      const sortedPgFiles = sortBy(pgFiles, (file) => getFileNameFromKey(file.key));

      // The .jpg at index 0 should fail and have the original object values as
      // it's assigned `fakeBucket`
      t.like(sortedPgFiles[0], {
        ...omit(newGranule.files[0], ['fileName', 'size', 'createdAt', 'updatedAt']),
      });

      for (let i = 1; i <= 2; i += 1) {
        const fileName = sortedPgFiles[i].file_name;
        const destination = destinations.find((dest) => fileName.match(dest.regex));

        t.is(destination.bucket, sortedPgFiles[i].bucket);
        t.like(sortedPgFiles[i], {
          ...omit(newGranule.files[i], ['fileName', 'size', 'createdAt', 'updatedAt']),
          key: `${destinationFilepath}/${fileName}`,
          bucket: destination.bucket,
        });
      }
    }
  );
});

test.serial('move a file and update ECHO10 xml metadata', async (t) => {
  const { internalBucket, publicBucket } = await setupBucketsConfig();
  const newGranule = fakeGranuleFactoryV2({ collectionId: t.context.collectionId });

  newGranule.files = [
    {
      bucket: internalBucket,
      fileName: `${newGranule.granuleId}.txt`,
      key: `${process.env.stackName}/original_filepath/${newGranule.granuleId}.txt`,
    },
    {
      bucket: publicBucket,
      fileName: `${newGranule.granuleId}.cmr.xml`,
      key: `${process.env.stackName}/original_filepath/${newGranule.granuleId}.cmr.xml`,
    },
  ];

  await granuleModel.create(newGranule);

  const postgresNewGranule = await translateApiGranuleToPostgresGranule({
    dynamoRecord: newGranule,
    knexOrTransaction: t.context.knex,
  });
  postgresNewGranule.collection_cumulus_id = t.context.collectionCumulusId;

  const [postgresGranule] = await granulePgModel.create(
    t.context.knex, postgresNewGranule
  );
  const postgresNewGranuleFiles = newGranule.files.map((file) => {
    const translatedFile = translateApiFiletoPostgresFile(file);
    translatedFile.granule_cumulus_id = postgresGranule.cumulus_id;
    return translatedFile;
  });
  await Promise.all(
    postgresNewGranuleFiles.map((file) =>
      filePgModel.create(t.context.knex, file))
  );
  await granuleModel.create(newGranule, t.context.knex);

  await s3PutObject({
    Bucket: newGranule.files[0].bucket,
    Key: newGranule.files[0].key,
    Body: 'test data',
  });

  await s3PutObject({
    Bucket: newGranule.files[1].bucket,
    Key: newGranule.files[1].key,
    Body: fs.createReadStream(path.resolve(__dirname, '../data/meta.xml')),
  });

  const originalXML = await metadataObjectFromCMRFile(
    buildS3Uri(newGranule.files[1].bucket, newGranule.files[1].key)
  );

  const destinationFilepath = `${process.env.stackName}/moved_granules`;
  const destinations = [
    {
      regex: '.*.txt$',
      bucket: internalBucket,
      filepath: destinationFilepath,
    },
  ];

  sinon.stub(
    CMR.prototype,
    'ingestGranule'
  ).returns({ result: { 'concept-id': 'id204842' } });

  const response = await request(app)
    .patch(`/granules/${newGranule.granuleId}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send({
      action: 'move',
      destinations,
    })
    .expect(200);

  const body = response.body;

  t.is(body.status, 'SUCCESS');
  t.is(body.action, 'move');

  const list = await s3().listObjects({
    Bucket: internalBucket,
    Prefix: destinationFilepath,
  });
  t.is(list.Contents.length, 1);
  t.is(list.Contents[0].Key.indexOf(destinationFilepath), 0);

  const list2 = await s3().listObjects({
    Bucket: publicBucket,
    Prefix: `${process.env.stackName}/original_filepath`,
  });
  t.is(list2.Contents.length, 1);
  t.is(newGranule.files[1].key, list2.Contents[0].Key);

  const xmlObject = await metadataObjectFromCMRFile(
    buildS3Uri(newGranule.files[1].bucket, newGranule.files[1].key)
  );

  const newUrls = xmlObject.Granule.OnlineAccessURLs.OnlineAccessURL.map((obj) => obj.URL);
  const newDestination = `${process.env.DISTRIBUTION_ENDPOINT}${destinations[0].bucket}/${destinations[0].filepath}/${newGranule.files[0].fileName}`;
  t.true(newUrls.includes(newDestination));

  // All original URLs are unchanged (because they weren't involved in the granule move)
  const originalURLObjects = originalXML.Granule.OnlineAccessURLs.OnlineAccessURL;
  const originalURLs = originalURLObjects.map((urlObj) => urlObj.URL);
  originalURLs.forEach((originalURL) => {
    t.true(newUrls.includes(originalURL));
  });

  CMR.prototype.ingestGranule.restore();
  await recursivelyDeleteS3Bucket(publicBucket);
});

test.serial('move a file and update its UMM-G JSON metadata', async (t) => {
  const { internalBucket, publicBucket } = await setupBucketsConfig();

  const newGranule = fakeGranuleFactoryV2({ collectionId: t.context.collectionId });
  const ummgMetadataString = fs.readFileSync(path.resolve(__dirname, '../data/ummg-meta.json'));
  const originalUMMG = JSON.parse(ummgMetadataString);

  newGranule.files = [
    {
      bucket: internalBucket,
      fileName: `${newGranule.granuleId}.txt`,
      key: `${process.env.stackName}/original_filepath/${newGranule.granuleId}.txt`,
    },
    {
      bucket: publicBucket,
      fileName: `${newGranule.granuleId}.cmr.json`,
      key: `${process.env.stackName}/original_filepath/${newGranule.granuleId}.cmr.json`,
    },
  ];

  const postgresNewGranule = await translateApiGranuleToPostgresGranule({
    dynamoRecord: newGranule,
    knexOrTransaction: t.context.knex,
  });
  postgresNewGranule.collection_cumulus_id = t.context.collectionCumulusId;

  const [postgresGranule] = await granulePgModel.create(
    t.context.knex, postgresNewGranule
  );
  const postgresNewGranuleFiles = newGranule.files.map((file) => {
    const translatedFile = translateApiFiletoPostgresFile(file);
    translatedFile.granule_cumulus_id = postgresGranule.cumulus_id;
    return translatedFile;
  });
  await Promise.all(
    postgresNewGranuleFiles.map((file) =>
      filePgModel.create(t.context.knex, file))
  );
  await granuleModel.create(newGranule);

  await Promise.all(newGranule.files.map((file) => {
    if (file.name === `${newGranule.granuleId}.txt`) {
      return s3PutObject({ Bucket: file.bucket, Key: file.key, Body: 'test data' });
    }
    return s3PutObject({ Bucket: file.bucket, Key: file.key, Body: ummgMetadataString });
  }));

  const destinationFilepath = `${process.env.stackName}/moved_granules/${randomString()}`;
  const destinations = [
    {
      regex: '.*.txt$',
      bucket: internalBucket,
      filepath: destinationFilepath,
    },
  ];

  sinon.stub(
    CMR.prototype,
    'ingestUMMGranule'
  ).returns({ result: { 'concept-id': 'id204842' } });

  const response = await request(app)
    .patch(`/granules/${newGranule.granuleId}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send({
      action: 'move',
      destinations,
    })
    .expect(200);

  const body = response.body;

  t.is(body.status, 'SUCCESS');
  t.is(body.action, 'move');

  // text file has moved to correct location
  const list = await s3().listObjects({
    Bucket: internalBucket,
    Prefix: destinationFilepath,
  });
  t.is(list.Contents.length, 1);
  t.is(list.Contents[0].Key.indexOf(destinationFilepath), 0);

  // CMR JSON  is in same location.
  const list2 = await s3().listObjects({
    Bucket: publicBucket,
    Prefix: `${process.env.stackName}/original_filepath`,
  });
  t.is(list2.Contents.length, 1);
  t.is(newGranule.files[1].key, list2.Contents[0].Key);

  // CMR UMMG JSON has been updated with the location of the moved file.
  const ummgObject = await metadataObjectFromCMRFile(
    buildS3Uri(newGranule.files[1].bucket, newGranule.files[1].key)
  );
  const updatedURLs = ummgObject.RelatedUrls.map((urlObj) => urlObj.URL);
  const newDestination = `${process.env.DISTRIBUTION_ENDPOINT}${destinations[0].bucket}/${destinations[0].filepath}/${newGranule.files[0].fileName}`;
  t.true(updatedURLs.includes(newDestination));

  // Original metadata is also unchanged.
  const origURLs = originalUMMG.RelatedUrls.map((urlObj) => urlObj.URL);
  origURLs.forEach((origURL) => {
    t.true(updatedURLs.includes(origURL));
  });

  CMR.prototype.ingestUMMGranule.restore();
  await recursivelyDeleteS3Bucket(publicBucket);
});

test.serial('PATCH with action move returns failure if one granule file exists', async (t) => {
  const filesExistingStub = sinon.stub(models.Granule.prototype, 'getFilesExistingAtLocation').returns([{ fileName: 'file1' }]);

  const granule = t.context.fakeGranules[0];

  await granuleModel.create(granule);

  const body = {
    action: 'move',
    destinations: [{
      regex: '.*.hdf$',
      bucket: 'fake-bucket',
      filepath: 'fake-destination',
    }],
  };

  const response = await request(app)
    .patch(`/granules/${granule.granuleId}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(body)
    .expect(409);

  const responseBody = response.body;
  t.is(response.status, 409);
  t.is(responseBody.message,
    'Cannot move granule because the following files would be overwritten at the destination location: file1. Delete the existing files or reingest the source files.');

  filesExistingStub.restore();
});

test.serial('PATCH with action move returns failure if more than one granule file exists', async (t) => {
  const filesExistingStub = sinon.stub(models.Granule.prototype, 'getFilesExistingAtLocation').returns([
    { fileName: 'file1' },
    { fileName: 'file2' },
    { fileName: 'file3' },
  ]);
  const granule = t.context.fakeGranules[0];

  await granuleModel.create(granule);

  const body = {
    action: 'move',
    destinations: [{
      regex: '.*.hdf$',
      bucket: 'fake-bucket',
      filepath: 'fake-destination',
    }],
  };

  const response = await request(app)
    .patch(`/granules/${granule.granuleId}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(body)
    .expect(409);

  const responseBody = response.body;
  t.is(response.statusCode, 409);
  t.is(responseBody.message,
    'Cannot move granule because the following files would be overwritten at the destination location: file1, file2, file3. Delete the existing files or reingest the source files.');

  filesExistingStub.restore();
});

test.serial('create (POST) creates new granule without an execution in DynamoDB, PostgreSQL, and Elasticsearch', async (t) => {
  const newGranule = fakeGranuleFactoryV2({
    collectionId: t.context.collectionId,
    execution: undefined,
  });

  const response = await request(app)
    .post('/granules')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .set('Accept', 'application/json')
    .send(newGranule)
    .expect(200);

  const fetchedDynamoRecord = await granuleModel.get({
    granuleId: newGranule.granuleId,
  });

  const fetchedPostgresRecord = await granulePgModel.get(
    t.context.knex,
    {
      granule_id: newGranule.granuleId,
      collection_cumulus_id: t.context.collectionCumulusId,
    }
  );
  const fetchedESRecord = await t.context.esGranulesClient.get(
    newGranule.granuleId
  );

  t.deepEqual(
    JSON.parse(response.text),
    { message: `Successfully wrote granule with Granule Id: ${newGranule.granuleId}, Collection Id: ${t.context.collectionId}` }
  );
  t.is(fetchedDynamoRecord.granuleId, newGranule.granuleId);
  t.is(fetchedPostgresRecord.granule_id, newGranule.granuleId);
  t.is(fetchedESRecord.granuleId, newGranule.granuleId);
});

test.serial('create (POST) creates new granule with associated execution in DynamoDB, PostgreSQL and Elasticsearch', async (t) => {
  const newGranule = fakeGranuleFactoryV2({
    collectionId: t.context.collectionId,
    execution: t.context.executionUrl,
  });

  const response = await request(app)
    .post('/granules')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .set('Accept', 'application/json')
    .send(newGranule)
    .expect(200);

  const fetchedDynamoRecord = await granuleModel.get({
    granuleId: newGranule.granuleId,
  });

  const fetchedPostgresRecord = await granulePgModel.get(
    t.context.knex,
    {
      granule_id: newGranule.granuleId,
      collection_cumulus_id: t.context.collectionCumulusId,
    }
  );
  const fetchedESRecord = await t.context.esGranulesClient.get(
    newGranule.granuleId
  );
  t.deepEqual(
    JSON.parse(response.text),
    { message: `Successfully wrote granule with Granule Id: ${newGranule.granuleId}, Collection Id: ${newGranule.collectionId}` }
  );
  t.is(fetchedDynamoRecord.granuleId, newGranule.granuleId);
  t.is(fetchedPostgresRecord.granule_id, newGranule.granuleId);
  t.is(fetchedESRecord.granuleId, newGranule.granuleId);
});

test.serial('create (POST) publishes an SNS message upon successful granule creation', async (t) => {
  const newGranule = fakeGranuleFactoryV2({
    collectionId: t.context.collectionId,
    execution: t.context.executionUrl,
  });

  await request(app)
    .post('/granules')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .set('Accept', 'application/json')
    .send(newGranule)
    .expect(200);

  const { Messages } = await sqs().receiveMessage({
    QueueUrl: t.context.QueueUrl,
    WaitTimeSeconds: 10,
  }).promise();
  t.is(Messages.length, 1);
});

test.serial('create (POST) rejects if a granule already exists in postgres', async (t) => {
  const newGranule = fakeGranuleFactoryV2({
    collectionId: t.context.collectionId,
    execution: undefined,
  });

  await request(app)
    .post('/granules')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .set('Accept', 'application/json')
    .send(newGranule)
    .expect(200);

  const response = await request(app)
    .post('/granules')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .set('Accept', 'application/json')
    .send(newGranule)
    .expect(409);

  const errorText = JSON.parse(response.error.text);
  t.is(errorText.statusCode, 409);
  t.is(errorText.error, 'Conflict');
  t.is(errorText.message, `A granule already exists for granuleId: ${newGranule.granuleId}`);
});

test.serial('create (POST) returns bad request if a granule is submitted with a bad collectionId', async (t) => {
  const newGranule = fakeGranuleFactoryV2({
    collectionId: randomId('collectionId'),
  });

  const response = await request(app)
    .post('/granules')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .set('Accept', 'application/json')
    .send(newGranule)
    .expect(400);

  t.is(response.statusCode, 400);
  t.is(response.error.status, 400);
  t.is(response.error.message, 'cannot POST /granules (400)');
});

test.serial('create (POST) returns bad request if a granule is submitted without a status set', async (t) => {
  const newGranule = fakeGranuleFactoryV2({
    collectionId: t.context.collectionId,
    execution: t.context.executionUrl,
  });

  delete newGranule.status;

  const response = await request(app)
    .post('/granules')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .set('Accept', 'application/json')
    .send(newGranule)
    .expect(400);

  t.is(response.statusCode, 400);
  t.is(response.error.status, 400);
  t.is(response.error.message, 'cannot POST /granules (400)');
  t.true(response.text.includes('Error: granule `status` field must be set for a new granule write.  Please add a status field and value to your granule object and retry your request'));
});

test.serial('PATCH returns bad request if a new granule is submitted without a status set', async (t) => {
  const newGranule = fakeGranuleFactoryV2({
    collectionId: t.context.collectionId,
    execution: t.context.executionUrl,
  });

  delete newGranule.status;

  const response = await request(app)
    .patch(`/granules/${newGranule.granuleId}`)
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .set('Accept', 'application/json')
    .send(newGranule)
    .expect(400);

  t.is(response.statusCode, 400);
  t.is(response.error.status, 400);
  t.is(response.error.message, `cannot PATCH /granules/${newGranule.granuleId} (400)`);
  t.true(response.text.includes('Error: granule `status` field must be set for a new granule write.  Please add a status field and value to your granule object and retry your request'));
});

test.serial('create (POST) throws conflict error if a granule with same granuleId but different collectionId already exists in postgres', async (t) => {
  const {
    collectionId,
    collectionPgModel,
    knex,
  } = t.context;

  const newGranule = fakeGranuleFactoryV2({
    collectionId: collectionId,
    execution: undefined,
  });

  // Create new collection for new granule with same granuleId
  const testPgCollection = fakeCollectionRecordFactory();
  const newCollectionId = constructCollectionId(
    testPgCollection.name,
    testPgCollection.version
  );

  await collectionPgModel.create(
    knex,
    testPgCollection
  );

  const newGranuleWithSameId = fakeGranuleFactoryV2({
    granuleId: newGranule.granuleId,
    collectionId: newCollectionId,
    execution: undefined,
  });

  await request(app)
    .post('/granules')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .set('Accept', 'application/json')
    .send(newGranule)
    .expect(200);

  const response = await request(app)
    .post('/granules')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .set('Accept', 'application/json')
    .send(newGranuleWithSameId)
    .expect(409);

  const errorText = JSON.parse(response.error.text);
  t.is(errorText.statusCode, 409);
  t.is(errorText.error, 'Conflict');
  t.is(errorText.message, `A granule already exists for granuleId: ${newGranule.granuleId}`);
});

test.serial('PATCH updates an existing granule in all data stores', async (t) => {
  const {
    esClient,
    executionUrl,
    knex,
    testExecutionCumulusId,
  } = t.context;
  const timestamp = Date.now();
  const {
    newPgGranule,
    newDynamoGranule,
    esRecord,
  } = await createGranuleAndFiles({
    dbClient: knex,
    esClient,
    executionCumulusId: testExecutionCumulusId,
    granuleParams: {
      status: 'running',
      execution: executionUrl,
    },
  });

  t.is(newDynamoGranule.status, 'running');
  t.is(newDynamoGranule.queryFields, undefined);
  t.is(newPgGranule.status, 'running');
  t.is(newPgGranule.query_fields, null);
  t.is(esRecord.status, 'running');
  t.is(esRecord.queryFields, undefined);

  const newQueryFields = {
    foo: randomString(),
  };
  const updatedGranule = {
    ...newDynamoGranule,
    status: 'completed',
    queryFields: newQueryFields,
    timestamp,
  };

  await request(app)
    .patch(`/granules/${newDynamoGranule.granuleId}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(updatedGranule)
    .expect(200);

  const actualGranule = await t.context.granuleModel.get({
    granuleId: newDynamoGranule.granuleId,
  });
  t.deepEqual(actualGranule, {
    ...newDynamoGranule,
    status: 'completed',
    timestamp,
    queryFields: newQueryFields,
    updatedAt: actualGranule.updatedAt,
  });

  const actualPgGranule = await t.context.granulePgModel.get(t.context.knex, {
    cumulus_id: newPgGranule.cumulus_id,
  });

  t.deepEqual(actualPgGranule, {
    ...newPgGranule,
    timestamp: new Date(timestamp),
    status: 'completed',
    query_fields: newQueryFields,
    updated_at: actualPgGranule.updated_at,
    last_update_date_time: actualPgGranule.last_update_date_time,
    beginning_date_time: actualPgGranule.beginning_date_time,
    ending_date_time: actualPgGranule.ending_date_time,
    production_date_time: actualPgGranule.production_date_time,
  });

  t.is(actualPgGranule.updated_at.getTime(), actualGranule.updatedAt);

  const updatedEsRecord = await t.context.esGranulesClient.get(
    newDynamoGranule.granuleId
  );
  t.like(
    updatedEsRecord,
    {
      ...esRecord,
      files: actualGranule.files,
      status: 'completed',
      queryFields: newQueryFields,
      updatedAt: updatedEsRecord.updatedAt,
      timestamp: updatedEsRecord.timestamp,
    }
  );
});

test.serial('PATCH executes successfully with no non-required-field-updates (testing "insert" update/undefined fields)', async (t) => {
  const {
    esClient,
    executionPgRecord,
    executionUrl,
    knex,
  } = t.context;
  const timestamp = Date.now();
  const {
    esRecord,
    newDynamoGranule,
    newPgGranule,
  } = await createGranuleAndFiles({
    dbClient: knex,
    esClient,
    executionCumulusId: executionPgRecord.cumulus_id,
    granuleParams: {
      status: 'running',
      execution: executionUrl,
      timestamp,
    },
  });

  const updatedGranule = {
    granuleId: newDynamoGranule.granuleId,
    collectionId: newDynamoGranule.collectionId,
  };

  await request(app)
    .patch(`/granules/${newDynamoGranule.granuleId}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(updatedGranule)
    .expect(200);

  const actualGranule = await t.context.granuleModel.get({
    granuleId: newDynamoGranule.granuleId,
  });
  t.deepEqual(actualGranule, {
    ...newDynamoGranule,
    timestamp: actualGranule.timestamp,
    updatedAt: actualGranule.updatedAt,
  });
  const actualPgGranule = await t.context.granulePgModel.get(t.context.knex, {
    cumulus_id: newPgGranule.cumulus_id,
  });

  t.deepEqual(actualPgGranule, {
    ...newPgGranule,
    timestamp: actualPgGranule.timestamp,
    updated_at: actualPgGranule.updated_at,
  });

  t.is(actualPgGranule.updated_at.getTime(), actualGranule.updatedAt);

  const updatedEsRecord = await t.context.esGranulesClient.get(
    newDynamoGranule.granuleId
  );
  t.like(updatedEsRecord, {
    ...esRecord,
    timestamp: actualGranule.timestamp,
    updatedAt: actualGranule.updatedAt,
  });
});

test.serial('PATCH does not update non-current-timestamp undefined fields for existing granules in all datastores', async (t) => {
  const {
    esClient,
    knex,
    executionPgRecord,
    esGranulesClient,
    testExecutionCumulusId,
  } = t.context;

  const originalUpdateTimestamp = Date.now();

  const {
    esRecord,
    newDynamoGranule,
    newPgGranule,
  } = await createGranuleAndFiles({
    dbClient: knex,
    esClient,
    executionCumulusId: testExecutionCumulusId,
    granuleParams: {
      beginningDateTime: '2022-01-18T14:40:00.000Z',
      cmrLink: 'example.com',
      collectionId: constructCollectionId(t.context.collectionName, t.context.collectionVersion),
      duration: 1000,
      execution: t.context.executionUrl,
      endingDateTime: '2022-01-18T14:40:00.000Z',
      error: { errorKey: 'errorValue' },
      lastUpdateDateTime: '2022-01-18T14:40:00.000Z',
      pdrName: t.context.pdr.name,
      processingEndDateTime: '2022-01-18T14:40:00.000Z',
      processingStartDateTime: '2022-01-18T14:40:00.000Z',
      productionDateTime: '2022-01-18T14:40:00.000Z',
      productVolume: '1000',
      published: true,
      queryFields: { queryFieldsKey: 'queryFieldsValue' },
      status: 'completed',
      timestamp: originalUpdateTimestamp,
      timeToArchive: 1000,
      timeToPreprocess: 1000,
      updatedAt: originalUpdateTimestamp,
    },
  });

  await granulesExecutionsPgModel.create(knex, {
    granule_cumulus_id: newPgGranule.cumulus_id,
    execution_cumulus_id: executionPgRecord.cumulus_id,
  });

  const updatedGranule = {
    granuleId: newDynamoGranule.granuleId,
    collectionId: newDynamoGranule.collectionId,
    status: newDynamoGranule.status,
  };

  await request(app)
    .patch(`/granules/${newDynamoGranule.granuleId}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(updatedGranule)
    .expect(200);

  const actualGranule = await granuleModel.get({
    granuleId: newDynamoGranule.granuleId,
  });

  const actualPgGranule = await granulePgModel.get(knex, {
    cumulus_id: newPgGranule.cumulus_id,
  });

  const translatedPostgresGranule = await translatePostgresGranuleToApiGranule({
    granulePgRecord: actualPgGranule,
    knexOrTransaction: knex,
  });

  const updatedEsRecord = await esGranulesClient.get(
    newDynamoGranule.granuleId
  );

  [
    updatedEsRecord,
    esRecord,
    newDynamoGranule,
    translatedPostgresGranule,
    actualGranule,
  ].forEach((record) => {
    record.files.sort((f1, f2) => sortFilesByKey(f1, f2));
  });

  t.deepEqual(actualGranule, {
    ...newDynamoGranule,
    updatedAt: actualGranule.updatedAt,
    timestamp: actualGranule.timestamp,
  });

  t.deepEqual(translatedPostgresGranule, {
    ...newDynamoGranule,
    updatedAt: actualGranule.updatedAt,
    timestamp: actualGranule.timestamp,
  });

  t.like(
    updatedEsRecord,
    {
      ...esRecord,
      updatedAt: actualGranule.updatedAt,
      timestamp: actualGranule.timestamp,
    }
  );
});

test.serial('PATCH nullifies expected fields for existing granules in all datastores', async (t) => {
  const {
    esClient,
    knex,
    executionPgRecord,
    esGranulesClient,
    testExecutionCumulusId,
  } = t.context;

  const originalUpdateTimestamp = Date.now();

  const {
    newPgGranule,
    newDynamoGranule,
  } = await createGranuleAndFiles({
    dbClient: knex,
    esClient,
    executionCumulusId: testExecutionCumulusId,
    granuleParams: {
      beginningDateTime: '2022-01-18T14:40:00.000Z',
      cmrLink: 'example.com',
      collectionId: constructCollectionId(t.context.collectionName, t.context.collectionVersion),
      duration: 1000,
      execution: t.context.executionUrl,
      endingDateTime: '2022-01-18T14:40:00.000Z',
      error: { errorKey: 'errorValue' },
      lastUpdateDateTime: '2022-01-18T14:40:00.000Z',
      pdrName: t.context.pdr.name,
      processingEndDateTime: '2022-01-18T14:40:00.000Z',
      processingStartDateTime: '2022-01-18T14:40:00.000Z',
      productionDateTime: '2022-01-18T14:40:00.000Z',
      productVolume: '1000',
      published: true,
      queryFields: { queryFieldsKey: 'queryFieldsValue' },
      status: 'completed',
      timestamp: originalUpdateTimestamp,
      timeToArchive: 1000,
      timeToPreprocess: 1000,
      updatedAt: originalUpdateTimestamp,
    },
  });

  await granulesExecutionsPgModel.create(knex, {
    granule_cumulus_id: newPgGranule.cumulus_id,
    execution_cumulus_id: executionPgRecord.cumulus_id,
  });

  const updatedGranule = {
    granuleId: newDynamoGranule.granuleId,
    collectionId: newDynamoGranule.collectionId,
    status: newDynamoGranule.status,
    createdAt: null,
    beginningDateTime: null,
    cmrLink: null,
    duration: null,
    endingDateTime: null,
    error: null,
    files: null,
    lastUpdateDateTime: null,
    pdrName: null,
    processingEndDateTime: null,
    processingStartDateTime: null,
    productionDateTime: null,
    productVolume: null,
    published: null,
    queryFields: null,
    timestamp: null,
    timeToArchive: null,
    timeToPreprocess: null,
    updatedAt: null,
  };

  await request(app)
    .patch(`/granules/${newDynamoGranule.granuleId}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(updatedGranule)
    .expect(200);

  const actualGranule = await granuleModel.get({
    granuleId: newDynamoGranule.granuleId,
  });

  const actualPgGranule = await granulePgModel.get(knex, {
    cumulus_id: newPgGranule.cumulus_id,
  });

  const translatedPostgresGranule = await translatePostgresGranuleToApiGranule({
    granulePgRecord: actualPgGranule,
    knexOrTransaction: knex,
  });

  const updatedEsRecord = await esGranulesClient.get(
    newDynamoGranule.granuleId
  );

  const expectedGranule = {
    granuleId: newDynamoGranule.granuleId,
    collectionId: newDynamoGranule.collectionId,
    status: newDynamoGranule.status,
    execution: newDynamoGranule.execution,
    createdAt: actualGranule.createdAt,
    updatedAt: actualGranule.updatedAt,
    timestamp: actualGranule.timestamp,
    error: {},
    published: false,
  };

  //t.deepEqual(actualGranule, { ...expectedGranule, files: [] });
  t.deepEqual(actualGranule, expectedGranule);
  t.deepEqual(translatedPostgresGranule, { ...expectedGranule, files: [] });
  t.deepEqual(updatedEsRecord, { ...expectedGranule, _id: updatedEsRecord._id });
});

// FUTURE: this is explicitly a PATCH behavior test -
// moving this is part of CUMULUS-3069/CUMULUS-3072
test.serial(
  'PATCH does not overwrite existing duration of an existing granule if not specified in the payload',
  async (t) => {
    const { esClient, executionUrl, knex, testExecutionCumulusId } = t.context;

    const unmodifiedDuration = 100;
    const { newPgGranule, newDynamoGranule, esRecord } =
      await createGranuleAndFiles({
        dbClient: knex,
        esClient,
        executionCumulusId: testExecutionCumulusId,
        granuleParams: {
          execution: executionUrl,
          duration: unmodifiedDuration,
          status: 'completed',
        },
      });

    // Verify returned objects have correct status
    t.is(newDynamoGranule.status, 'completed');
    t.is(newPgGranule.status, 'completed');
    t.is(esRecord.status, 'completed');

    const newQueryFields = {
      foo: randomString(),
    };
    const updatedGranule = {
      granuleId: newDynamoGranule.granuleId,
      collectionId: newDynamoGranule.collectionId,
      status: 'completed',
      queryFields: newQueryFields,
    };

    await request(app)
      .patch(`/granules/${newDynamoGranule.granuleId}`)
      .set('Accept', 'application/json')
      .set('Authorization', `Bearer ${jwtAuthToken}`)
      .send(updatedGranule)
      .expect(200);

    const actualGranule = await t.context.granuleModel.get({
      granuleId: newDynamoGranule.granuleId,
    });
    const actualPgGranule = await t.context.granulePgModel.get(t.context.knex, {
      cumulus_id: newPgGranule.cumulus_id,
    });
    const actualEsGranule = await t.context.esGranulesClient.get(
      newDynamoGranule.granuleId
    );

    t.is(actualGranule.duration, unmodifiedDuration);
    t.is(actualPgGranule.duration, unmodifiedDuration);
    t.is(actualEsGranule.duration, unmodifiedDuration);
  }
);

test.serial('PATCH does not overwrite existing createdAt of an existing granule if not specified in the payload',
  async (t) => {
    const { esClient, executionUrl, knex, testExecutionCumulusId } = t.context;

    const timestamp = Date.now();
    const createdAt = timestamp - 1000000;

    const { newPgGranule, newDynamoGranule, esRecord } =
      await createGranuleAndFiles({
        dbClient: knex,
        esClient,
        executionCumulusId: testExecutionCumulusId,
        granuleParams: {
          createdAt,
          status: 'completed',
          execution: executionUrl,
        },
      });

    // Verify returned objects have correct status
    t.is(newDynamoGranule.status, 'completed');
    t.is(newPgGranule.status, 'completed');
    t.is(esRecord.status, 'completed');
    t.is(newDynamoGranule.createdAt, createdAt);
    t.deepEqual(newPgGranule.created_at, new Date(createdAt));
    t.is(esRecord.createdAt, createdAt);

    const updatedGranule = {
      granuleId: newDynamoGranule.granuleId,
      collectionId: newDynamoGranule.collectionId,
      status: 'completed',
    };

    await request(app)
      .patch(`/granules/${newDynamoGranule.granuleId}`)
      .set('Accept', 'application/json')
      .set('Authorization', `Bearer ${jwtAuthToken}`)
      .send(updatedGranule)
      .expect(200);

    const actualGranule = await t.context.granuleModel.get({
      granuleId: newDynamoGranule.granuleId,
    });
    const actualPgGranule = await t.context.granulePgModel.get(t.context.knex, {
      cumulus_id: newPgGranule.cumulus_id,
    });
    const actualEsGranule = await t.context.esGranulesClient.get(
      newDynamoGranule.granuleId
    );

    t.is(actualGranule.createdAt, createdAt);
    t.deepEqual(actualPgGranule.created_at, new Date(createdAt));
    t.is(actualEsGranule.createdAt, createdAt);
  });

test.serial('PATCH creates a granule if one does not already exist in all data stores', async (t) => {
  const {
    knex,
  } = t.context;

  const granuleId = `${cryptoRandomString({ length: 7 })}.${cryptoRandomString({ length: 20 })}.hdf`;

  const fakeGranule = fakeGranuleFactoryV2({
    granuleId,
    status: 'completed',
    execution: t.context.executionUrl,
    duration: 47.125,
    error: {},
  });

  await request(app)
    .patch(`/granules/${fakeGranule.granuleId}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(fakeGranule)
    .expect(201);

  const fakePgGranule = await translateApiGranuleToPostgresGranule({
    dynamoRecord: fakeGranule,
    knexOrTransaction: knex,
  });

  const actualGranule = await t.context.granuleModel.get({
    granuleId: fakeGranule.granuleId,
  });

  t.deepEqual(actualGranule, {
    ...fakeGranule,
    timestamp: actualGranule.timestamp,
  });

  const actualPgGranule = await t.context.granulePgModel.get(knex, {
    granule_id: actualGranule.granuleId,
    collection_cumulus_id: t.context.collectionCumulusId,
  });

  t.deepEqual(
    removeNilProperties(actualPgGranule),
    {
      ...fakePgGranule,
      timestamp: actualPgGranule.timestamp,
      cumulus_id: actualPgGranule.cumulus_id,
    }
  );

  t.is(actualPgGranule.updated_at.getTime(), actualGranule.updatedAt);

  const esRecord = await t.context.esGranulesClient.get(
    fakeGranule.granuleId
  );
  t.deepEqual(
    esRecord,
    {
      ...fakeGranule,
      timestamp: actualGranule.timestamp,
      _id: esRecord._id,
    }
  );
});

test.serial('PATCH sets a default value of false for `published` if one is not set', async (t) => {
  const {
    knex,
  } = t.context;

  const granuleId = `${cryptoRandomString({ length: 7 })}.${cryptoRandomString({ length: 20 })}.hdf`;

  const fakeGranule = fakeGranuleFactoryV2({
    granuleId,
    status: 'completed',
    execution: t.context.executionUrl,
    duration: 47.125,
  });
  delete fakeGranule.published;

  await request(app)
    .patch(`/granules/${fakeGranule.granuleId}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(fakeGranule)
    .expect(201);

  const fakeDynamoGranule = await t.context.granuleModel.get({
    granuleId: fakeGranule.granuleId,
  });

  const fakePgGranule = await t.context.granulePgModel.get(knex, {
    granule_id: fakeGranule.granuleId,
    collection_cumulus_id: t.context.collectionCumulusId,
  });

  const fakeEsRecord = await t.context.esGranulesClient.get(
    fakeGranule.granuleId
  );

  t.is(fakeDynamoGranule.published, false);
  t.is(fakePgGranule.published, false);
  t.is(fakeEsRecord.published, false);
});

test.serial('PATCH replaces an existing granule in all data stores with correct timestamps', async (t) => {
  const {
    esClient,
    executionUrl,
    knex,
    testExecutionCumulusId,
  } = t.context;
  const {
    newPgGranule,
    newDynamoGranule,
  } = await createGranuleAndFiles({
    dbClient: knex,
    esClient,
    executionCumulusId: testExecutionCumulusId,
    granuleParams: {
      status: 'running',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      execution: executionUrl,
    },
  });

  const updatedGranule = {
    ...newDynamoGranule,
    updatedAt: Date.now(),
    status: 'completed',
  };

  await request(app)
    .patch(`/granules/${newDynamoGranule.granuleId}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(updatedGranule)
    .expect(200);

  const actualGranule = await t.context.granuleModel.get({
    granuleId: newDynamoGranule.granuleId,
  });
  const actualPgGranule = await t.context.granulePgModel.get(t.context.knex, {
    cumulus_id: newPgGranule.cumulus_id,
  });
  const updatedEsRecord = await t.context.esGranulesClient.get(
    newDynamoGranule.granuleId
  );

  t.is(actualGranule.updatedAt, updatedGranule.updatedAt);
  // createdAt timestamp from original record should have been preserved
  t.is(actualGranule.createdAt, newDynamoGranule.createdAt);
  // PG and Dynamo records have the same timestamps
  t.is(actualPgGranule.created_at.getTime(), actualGranule.createdAt);
  t.is(actualPgGranule.updated_at.getTime(), actualGranule.updatedAt);
  t.is(actualPgGranule.created_at.getTime(), updatedEsRecord.createdAt);
  t.is(actualPgGranule.updated_at.getTime(), updatedEsRecord.updatedAt);
});

test.serial('PATCH replaces an existing granule in all datastores with a granule that violates message-path write constraints, ignoring message write constraints and field selection', async (t) => {
  const {
    esClient,
    executionUrl,
    knex,
    testExecutionCumulusId,
  } = t.context;
  const {
    newPgGranule,
    newDynamoGranule,
  } = await createGranuleAndFiles({
    dbClient: knex,
    esClient,
    executionCumulusId: testExecutionCumulusId,
    granuleParams: {
      status: 'completed',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      execution: executionUrl,
    },
  });

  const updatedGranule = {
    ...newDynamoGranule,
    updatedAt: 1,
    createdAt: 1,
    duration: 100,
    cmrLink: 'updatedLink',
    status: 'running',
  };

  await request(app)
    .patch(`/granules/${newDynamoGranule.granuleId}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(updatedGranule)
    .expect(200);

  const actualGranule = await t.context.granuleModel.get({
    granuleId: newDynamoGranule.granuleId,
  });
  const actualPgGranule = await t.context.granulePgModel.get(t.context.knex, {
    cumulus_id: newPgGranule.cumulus_id,
  });
  const updatedEsRecord = await t.context.esGranulesClient.get(
    newDynamoGranule.granuleId
  );

  t.is(actualGranule.updatedAt, updatedGranule.updatedAt);
  t.is(actualGranule.createdAt, updatedGranule.createdAt);
  // PG and Dynamo records have the same timestamps
  t.is(actualPgGranule.created_at.getTime(), actualGranule.createdAt);
  t.is(actualPgGranule.updated_at.getTime(), actualGranule.updatedAt);
  t.is(actualPgGranule.created_at.getTime(), updatedEsRecord.createdAt);
  t.is(actualPgGranule.updated_at.getTime(), updatedEsRecord.updatedAt);

  t.is(actualGranule.cmrLink, updatedGranule.cmrLink);
  t.is(actualPgGranule.cmr_link, updatedGranule.cmrLink);
  t.is(updatedEsRecord.cmrLink, updatedGranule.cmrLink);

  t.is(actualGranule.duration, updatedGranule.duration);
  t.is(actualPgGranule.duration, updatedGranule.duration);
  t.is(updatedEsRecord.duration, updatedGranule.duration);
});

test.serial('PATCH publishes an SNS message after a successful granule update', async (t) => {
  const {
    collectionCumulusId,
    esClient,
    executionUrl,
    knex,
    testExecutionCumulusId,
  } = t.context;
  const {
    newPgGranule,
    newDynamoGranule,
  } = await createGranuleAndFiles({
    dbClient: knex,
    esClient,
    executionCumulusId: testExecutionCumulusId,
    granuleParams: {
      status: 'running',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      execution: executionUrl,
    },
    collection_cumulus_id: collectionCumulusId,
  });

  const updatedGranule = {
    ...newDynamoGranule,
    updatedAt: Date.now(),
    createdAt: Date.now(),
  };

  await request(app)
    .patch(`/granules/${newDynamoGranule.granuleId}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(updatedGranule)
    .expect(200);

  const actualPgGranule = await t.context.granulePgModel.get(t.context.knex, {
    cumulus_id: newPgGranule.cumulus_id,
  });
  const translatedGranule = await translatePostgresGranuleToApiGranule({
    granulePgRecord: actualPgGranule,
    knexOrTransaction: knex,
  });

  const { Messages } = await sqs().receiveMessage({
    QueueUrl: t.context.QueueUrl,
    WaitTimeSeconds: 10,
  }).promise();
  const snsMessageBody = JSON.parse(Messages[0].Body);
  const publishedMessage = JSON.parse(snsMessageBody.Message);

  t.deepEqual(publishedMessage.record, translatedGranule);
  t.is(publishedMessage.event, 'Update');
});

test.serial("create() sets a default createdAt value for passed granule if it's not set by the user", async (t) => {
  const {
    esClient,
    executionUrl,
    knex,
    testExecutionCumulusId,
  } = t.context;

  const {
    newDynamoGranule,
  } = await createGranuleAndFiles({
    dbClient: knex,
    esClient,
    executionCumulusId: testExecutionCumulusId,
    granuleParams: {
      status: 'running',
      execution: executionUrl,
    },
  });

  const newGranuleId = randomId('granule');
  const createGranuleFromApiMethodStub = sinon.stub();
  const updatedGranule = {
    ...newDynamoGranule,
    granuleId: newGranuleId,
  };
  delete updatedGranule.createdAt;
  const expressRequest = {
    params: {
      granuleName: updatedGranule.granuleId,
    },
    body: updatedGranule,
    testContext: {
      knex,
      createGranuleFromApiMethod: createGranuleFromApiMethodStub,
    },
  };
  const response = buildFakeExpressResponse();
  await create(expressRequest, response);

  t.truthy(createGranuleFromApiMethodStub.getCalls()[0].args[0].createdAt);
});

test.serial("patch() sets a default createdAt value for new granule if it's not set by the user", async (t) => {
  const {
    esClient,
    executionUrl,
    knex,
    testExecutionCumulusId,
  } = t.context;

  const {
    newDynamoGranule,
  } = await createGranuleAndFiles({
    dbClient: knex,
    esClient,
    executionCumulusId: testExecutionCumulusId,
    granuleParams: {
      status: 'running',
      execution: executionUrl,
    },
  });

  const newGranuleId = randomId('granule');
  const updateGranuleFromApiMethodStub = sinon.stub();
  const updatedGranule = {
    ...newDynamoGranule,
    granuleId: newGranuleId,
  };
  delete updatedGranule.createdAt;
  const expressRequest = {
    params: {
      granuleName: updatedGranule.granuleId,
    },
    body: updatedGranule,
    testContext: {
      knex,
      updateGranuleFromApiMethod: updateGranuleFromApiMethodStub,
    },
  };
  const response = buildFakeExpressResponse();
  await patchGranule(expressRequest, response);

  t.truthy(updateGranuleFromApiMethodStub.getCalls()[0].args[0].createdAt);
});

test.serial('PATCH() does not write to PostgreSQL/Elasticsearch/SNS if writing to DynamoDB fails', async (t) => {
  const {
    esClient,
    executionUrl,
    knex,
    testExecutionCumulusId,
  } = t.context;
  const {
    newPgGranule,
    newDynamoGranule,
    esRecord,
  } = await createGranuleAndFiles({
    dbClient: knex,
    esClient,
    granuleParams: {
      status: 'running',
      execution: executionUrl,
    },
    executionCumulusId: testExecutionCumulusId,
  });

  const fakeGranuleModel = {
    get: () => Promise.resolve(newDynamoGranule),
    storeGranule: () => {
      throw new Error('something bad');
    },
    delete: () => Promise.resolve(),
    create: () => Promise.resolve(),
  };

  const updatedGranule = {
    ...newDynamoGranule,
    status: 'completed',
    granuleModel: fakeGranuleModel,
  };

  const expressRequest = {
    params: {
      granuleName: newDynamoGranule.granuleId,
    },
    body: updatedGranule,
    testContext: {
      knex,
      granuleModel: fakeGranuleModel,
    },
  };

  const response = buildFakeExpressResponse();
  await patch(expressRequest, response);
  t.true(response.boom.badRequest.calledWithMatch('something bad'));

  t.deepEqual(
    await t.context.granuleModel.get({
      granuleId: newDynamoGranule.granuleId,
    }),
    newDynamoGranule
  );
  t.deepEqual(
    await t.context.granulePgModel.get(t.context.knex, {
      cumulus_id: newPgGranule.cumulus_id,
    }),
    newPgGranule
  );
  t.deepEqual(
    await t.context.esGranulesClient.get(
      newDynamoGranule.granuleId
    ),
    esRecord
  );

  const { Messages } = await sqs().receiveMessage({
    QueueUrl: t.context.QueueUrl,
    WaitTimeSeconds: 10,
  }).promise();
  t.is(Messages, undefined);
});

test.serial('PATCH() does not write to DynamoDB/Elasticsearch/SNS if writing to PostgreSQL fails', async (t) => {
  const {
    esClient,
    executionUrl,
    knex,
    testExecutionCumulusId,
  } = t.context;
  const {
    newPgGranule,
    newDynamoGranule,
    esRecord,
  } = await createGranuleAndFiles({
    dbClient: knex,
    esClient,
    granuleParams: {
      status: 'running',
      execution: executionUrl,
    },
    executionCumulusId: testExecutionCumulusId,
  });

  const fakeGranulePgModel = {
    upsert: () => {
      throw new Error('something bad');
    },
    search: () => [{
      created_at: new Date(),
    }],
    get: () => ({}),
  };

  const updatedGranule = {
    ...newDynamoGranule,
    status: 'completed',
    granulePgModel: fakeGranulePgModel,
  };

  const expressRequest = {
    params: {
      granuleName: newDynamoGranule.granuleId,
    },
    body: updatedGranule,
    testContext: {
      knex,
      granulePgModel: fakeGranulePgModel,
    },
  };

  const response = buildFakeExpressResponse();
  await patch(expressRequest, response);
  t.true(response.boom.badRequest.calledWithMatch('something bad'));

  t.deepEqual(
    await t.context.granuleModel.get({
      granuleId: newDynamoGranule.granuleId,
    }),
    newDynamoGranule
  );
  t.deepEqual(
    await t.context.granulePgModel.get(t.context.knex, {
      cumulus_id: newPgGranule.cumulus_id,
    }),
    newPgGranule
  );
  t.deepEqual(
    await t.context.esGranulesClient.get(
      newDynamoGranule.granuleId
    ),
    esRecord
  );

  const { Messages } = await sqs().receiveMessage({
    QueueUrl: t.context.QueueUrl,
    WaitTimeSeconds: 10,
  }).promise();
  t.is(Messages, undefined);
});

test.serial('PATCH() rolls back DynamoDB/PostgreSQL records and does not write to SNS if writing to Elasticsearch fails', async (t) => {
  const {
    esClient,
    executionUrl,
    knex,
    testExecutionCumulusId,
  } = t.context;
  const {
    newPgGranule,
    newDynamoGranule,
    esRecord,
  } = await createGranuleAndFiles({
    dbClient: knex,
    esClient,
    executionCumulusId: testExecutionCumulusId,
    granuleParams: { status: 'running', execution: executionUrl },
  });

  const fakeEsClient = {
    update: () => {
      throw new Error('something bad');
    },
    delete: () => Promise.resolve(),
  };

  const updatedGranule = {
    ...newDynamoGranule,
    status: 'completed',
  };

  const expressRequest = {
    params: {
      granuleName: newDynamoGranule.granuleId,
    },
    body: updatedGranule,
    testContext: {
      knex,
      esClient: fakeEsClient,
    },
  };

  const response = buildFakeExpressResponse();

  await patch(expressRequest, response);
  t.true(response.boom.badRequest.calledWithMatch('something bad'));

  const actualPgGranule = await t.context.granulePgModel.get(t.context.knex, {
    cumulus_id: newPgGranule.cumulus_id,
  });
  const expectedDynamoGranule = await translatePostgresGranuleToApiGranule(
    {
      granulePgRecord: actualPgGranule,
      knexOrTransaction: knex,
    }
  );
  const actualDynamoGranule = await t.context.granuleModel.get({
    granuleId: newDynamoGranule.granuleId,
  });

  t.deepEqual(
    actualDynamoGranule,
    expectedDynamoGranule
  );
  t.deepEqual(
    actualPgGranule,
    newPgGranule
  );
  t.deepEqual(
    await t.context.esGranulesClient.get(
      newDynamoGranule.granuleId
    ),
    esRecord
  );

  const { Messages } = await sqs().receiveMessage({
    QueueUrl: t.context.QueueUrl,
    WaitTimeSeconds: 10,
  }).promise();
  t.is(Messages, undefined);
});

test.serial('PATCH adds granule if it does not exist and returns a 201 status', async (t) => {
  const newGranule = fakeGranuleFactoryV2({
    collectionId: t.context.collectionId,
    execution: undefined,
  });

  const response = await request(app)
    .patch(`/granules/${newGranule.granuleId}`)
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .set('Accept', 'application/json')
    .send(newGranule)
    .expect(201);

  t.deepEqual(JSON.parse(response.text), {
    message: `Successfully wrote granule with Granule Id: ${newGranule.granuleId}, Collection Id: ${newGranule.collectionId}`,
  });
});

test.serial('PATCH sets defaults and adds new granule', async (t) => {
  const newGranule = fakeGranuleFactoryV2({
    collectionId: t.context.collectionId,
    execution: undefined,
    published: undefined,
    createdAt: undefined,
    updatedAt: undefined,
    error: undefined,
  });
  const granuleId = newGranule.granuleId;

  const response = await request(app)
    .patch(`/granules/${newGranule.granuleId}`)
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .set('Accept', 'application/json')
    .send(newGranule)
    .expect(201);

  t.deepEqual(JSON.parse(response.text), {
    message: `Successfully wrote granule with Granule Id: ${newGranule.granuleId}, Collection Id: ${newGranule.collectionId}`,
  });

  const dynamoRecord = await t.context.granuleModel.get({
    granuleId,
  });

  const postgresRecord = await t.context.granulePgModel.search(t.context.knex, {
    granule_id: granuleId,
  });

  const esRecord = await t.context.esGranulesClient.get(
    granuleId
  );

  const setCreatedAtValue = dynamoRecord.createdAt;
  const expectedApiGranule = {
    ...newGranule,
    createdAt: setCreatedAtValue,
    error: {},
    published: false,
    updatedAt: setCreatedAtValue,
  };

  t.like(dynamoRecord, expectedApiGranule);
  t.like(esRecord, expectedApiGranule);
  t.like(await translatePostgresGranuleToApiGranule({
    granulePgRecord: postgresRecord[0],
    knexOrTransaction: t.context.knex,
  }), expectedApiGranule);
});

test.serial('PATCH returns an updated granule with an undefined execution', async (t) => {
  const now = Date.now();
  const newGranule = fakeGranuleFactoryV2({
    collectionId: t.context.collectionId,
    createdAt: now,
    timestamp: now,
    execution: undefined,
  });

  const response = await request(app)
    .post('/granules')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .set('Accept', 'application/json')
    .send(newGranule)
    .expect(200);

  t.is(response.statusCode, 200);

  const modifiedGranule = {
    ...newGranule,
    status: 'failed',
    error: { some: 'error' },
  };

  const modifiedResponse = await request(app)
    .patch(`/granules/${newGranule.granuleId}`)
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .set('Accept', 'application/json')
    .send(modifiedGranule)
    .expect(200);

  t.is(modifiedResponse.statusCode, 200);

  const fetchedDynamoRecord = await granuleModel.get({
    granuleId: newGranule.granuleId,
  });

  const fetchedPostgresRecord = await granulePgModel.get(
    t.context.knex,
    {
      granule_id: newGranule.granuleId,
      collection_cumulus_id: t.context.collectionCumulusId,
    }
  );

  t.deepEqual(JSON.parse(modifiedResponse.text), {
    message: `Successfully updated granule with Granule Id: ${newGranule.granuleId}, Collection Id: ${newGranule.collectionId}`,
  });

  t.is(fetchedDynamoRecord.status, 'failed');
  t.deepEqual(fetchedDynamoRecord.error, { some: 'error' });
  t.is(fetchedDynamoRecord.createdAt, fetchedPostgresRecord.created_at.getTime());
  t.is(fetchedDynamoRecord.updatedAt, fetchedPostgresRecord.updated_at.getTime());
  t.is(fetchedDynamoRecord.timestamp, fetchedPostgresRecord.timestamp.getTime());
  t.is(fetchedPostgresRecord.status, 'failed');
  t.deepEqual(fetchedPostgresRecord.error, { some: 'error' });
});

test.serial('PATCH returns an updated granule with associated execution', async (t) => {
  const timestamp = Date.now();
  const createdAt = timestamp - 1000000;
  const newGranule = fakeGranuleFactoryV2({
    collectionId: t.context.collectionId,
    createdAt,
    timestamp,
    execution: undefined,
  });

  const response = await request(app)
    .post('/granules')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .set('Accept', 'application/json')
    .send(newGranule)
    .expect(200);

  t.is(response.statusCode, 200);

  const modifiedGranule = {
    ...newGranule,
    execution: t.context.executionUrl,
    status: 'failed',
    error: { some: 'error' },
  };

  const modifiedResponse = await request(app)
    .patch(`/granules/${newGranule.granuleId}`)
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .set('Accept', 'application/json')
    .send(modifiedGranule)
    .expect(200);

  t.is(modifiedResponse.statusCode, 200);

  const fetchedDynamoRecord = await granuleModel.get({
    granuleId: newGranule.granuleId,
  });

  const fetchedPostgresRecord = await granulePgModel.get(
    t.context.knex,
    {
      granule_id: newGranule.granuleId,
      collection_cumulus_id: t.context.collectionCumulusId,
    }
  );

  // get execution for this record.
  const granuleCumulusId = await granulePgModel.getRecordCumulusId(
    t.context.knex,
    {
      granule_id: newGranule.granuleId,
      collection_cumulus_id: t.context.collectionCumulusId,
    }
  );

  const granulesExecutionsPgRecord = await granulesExecutionsPgModel.search(
    t.context.knex,
    {
      granule_cumulus_id: granuleCumulusId,
    }
  );

  const executionPgRecord = await executionPgModel.searchByCumulusIds(
    t.context.knex,
    granulesExecutionsPgRecord[0].execution_cumulus_id
  );

  t.deepEqual(JSON.parse(modifiedResponse.text), {
    message: `Successfully updated granule with Granule Id: ${newGranule.granuleId}, Collection Id: ${newGranule.collectionId}`,
  });

  t.is(fetchedDynamoRecord.status, 'failed');
  t.deepEqual(fetchedDynamoRecord.error, { some: 'error' });
  t.is(fetchedDynamoRecord.execution, modifiedGranule.execution);

  t.is(fetchedPostgresRecord.status, 'failed');
  t.deepEqual(fetchedPostgresRecord.error, { some: 'error' });
  t.is(executionPgRecord[0].url, modifiedGranule.execution);

  t.is(fetchedDynamoRecord.createdAt, fetchedPostgresRecord.created_at.getTime());
  t.is(fetchedDynamoRecord.updatedAt, fetchedPostgresRecord.updated_at.getTime());
  t.is(fetchedDynamoRecord.timestamp, fetchedPostgresRecord.timestamp.getTime());
});

test.serial('PATCH returns bad request when the path param granuleName does not match the json granuleId', async (t) => {
  const newGranule = fakeGranuleFactoryV2({});
  const granuleName = `granuleName_${cryptoRandomString({ length: 10 })}`;

  const { body } = await request(app)
    .patch(`/granules/${granuleName}`)
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .set('Accept', 'application/json')
    .send(newGranule)
    .expect(400);

  t.is(body.statusCode, 400);
  t.is(body.error, 'Bad Request');
  t.is(body.message, `input :granuleName (${granuleName}) must match body's granuleId (${newGranule.granuleId})`);
});

test.serial('PATCH can set running granule status to queued', async (t) => {
  const granuleId = cryptoRandomString({ length: 6 });
  const runningGranule = fakeGranuleRecordFactory({
    granule_id: granuleId,
    status: 'running',
    collection_cumulus_id: t.context.collectionCumulusId,
  });

  granulesExecutionsPgModel = new GranulesExecutionsPgModel();

  const pgGranule = (await t.context.granulePgModel.create(t.context.knex, runningGranule))[0];
  await granulesExecutionsPgModel.create(t.context.knex, {
    granule_cumulus_id: pgGranule.cumulus_id,
    execution_cumulus_id: t.context.testExecutionCumulusId,
  });

  const response = await request(app)
    .patch(`/granules/${granuleId}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send({
      granuleId: granuleId,
      status: 'queued',
      collectionId: t.context.collectionId,
    });

  t.is(response.status, 200);
  t.deepEqual(JSON.parse(response.text), {
    message: `Successfully updated granule with Granule Id: ${granuleId}, Collection Id: ${t.context.collectionId}`,
  });
});

test.serial('PATCH will set completed status to queued', async (t) => {
  const granuleId = t.context.fakeGranules[0].granuleId;
  const response = await request(app)
    .patch(`/granules/${granuleId}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send({
      granuleId: granuleId,
      status: 'queued',
      collectionId: t.context.collectionId,
      execution: t.context.executionUrl,
    });

  t.is(response.status, 200);
  t.deepEqual(JSON.parse(response.text), {
    message: `Successfully updated granule with Granule Id: ${granuleId}, Collection Id: ${t.context.collectionId}`,
  });
  const fetchedDynamoRecord = await granuleModel.get({
    granuleId,
  });

  t.is(fetchedDynamoRecord.status, 'queued');
});

test.serial('PATCH can create a new granule with status queued', async (t) => {
  const granuleId = randomId('new-granule');
  const response = await request(app)
    .patch(`/granules/${granuleId}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send({
      granuleId: granuleId,
      status: 'queued',
      collectionId: t.context.collectionId,
    });

  t.is(response.status, 201);
  t.deepEqual(JSON.parse(response.text), {
    message: `Successfully wrote granule with Granule Id: ${granuleId}, Collection Id: ${t.context.collectionId}`,
  });
});

test.serial('PATCH throws conflict error when trying to update the collectionId of a granule', async (t) => {
  const {
    collectionId,
    collectionPgModel,
    knex,
  } = t.context;
  const newGranule = fakeGranuleFactoryV2({
    collectionId: collectionId,
    execution: undefined,
  });

  // Create granule
  await request(app)
    .post('/granules')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .set('Accept', 'application/json')
    .send(newGranule)
    .expect(200);

  const newCollection = fakeCollectionRecordFactory();
  await collectionPgModel.create(
    knex,
    newCollection
  );
  const newCollectionId = constructCollectionId(
    newCollection.name,
    newCollection.version
  );

  const updatedGranule = {
    ...newGranule,
    collectionId: newCollectionId,
  };

  const { body } = await request(app)
    .patch(`/granules/${newGranule.granuleId}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(updatedGranule)
    .expect(409);

  t.is(body.error, 'Conflict');
  t.is(body.message, `Modifying collectionId for a granule is not allowed. Write for granuleId: ${newGranule.granuleId} failed.`);
});

test.serial('associateExecution (POST) returns bad request if fields are missing in payload', async (t) => {
  const response = await request(app)
    .post(`/granules/${randomId('granuleId')}/executions`)
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .set('Accept', 'application/json')
    .expect(400);

  t.is(response.body.error, 'Bad Request');
  t.is(response.body.message, 'Field granuleId, collectionId or executionArn is missing from request body');
});

test.serial('associateExecution (POST) returns bad request when the path param granuleName does not match the granuleId in payload', async (t) => {
  const granuleIdInPath = randomId('granuleIdInPath');
  const granuleIdInRquest = randomId('granuleIdInRquest');

  const requestPayload = {
    collectionId: t.context.collectionId,
    executionArn: t.context.executionArn,
    granuleId: granuleIdInRquest,
  };
  const response = await request(app)
    .post(`/granules/${granuleIdInPath}/executions`)
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .set('Accept', 'application/json')
    .send(requestPayload)
    .expect(400);

  t.is(response.body.error, 'Bad Request');
  t.is(response.body.message, `Expected granuleId to be ${granuleIdInPath} but found ${granuleIdInRquest} in payload`);
});

test.serial('associateExecution (POST) returns Not Found if granule does not exist', async (t) => {
  const granuleId = randomId('granuleId');
  const requestPayload = {
    collectionId: t.context.collectionId,
    executionArn: t.context.executionArn,
    granuleId,
  };

  const response = await request(app)
    .post(`/granules/${granuleId}/executions`)
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .set('Accept', 'application/json')
    .send(requestPayload)
    .expect(404);

  t.is(response.body.error, 'Not Found');
  t.is(response.body.message, `No granule found to associate execution with for granuleId ${granuleId} and collectionId: ${t.context.collectionId}`);
});

test.serial('associateExecution (POST) associates an execution with a granule created without a createdAt timestamp', async (t) => {
  const timestamp = Date.now();
  const newGranule = fakeGranuleFactoryV2({
    collectionId: t.context.collectionId,
    timestamp,
    execution: undefined,
  });

  delete newGranule.createdAt;

  await request(app)
    .post('/granules')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .set('Accept', 'application/json')
    .send(newGranule)
    .expect(200);

  const requestPayload = {
    collectionId: t.context.collectionId,
    executionArn: t.context.executionArn,
    granuleId: newGranule.granuleId,
  };

  const response = await request(app)
    .post(`/granules/${newGranule.granuleId}/executions`)
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .set('Accept', 'application/json')
    .send(requestPayload)
    .expect(200);

  const fetchedDynamoRecord = await granuleModel.get({
    granuleId: newGranule.granuleId,
  });

  const fetchedPostgresRecord = await granulePgModel.get(
    t.context.knex,
    {
      granule_id: newGranule.granuleId,
      collection_cumulus_id: t.context.collectionCumulusId,
    }
  );

  // get execution for this record.
  const granuleCumulusId = await granulePgModel.getRecordCumulusId(
    t.context.knex,
    {
      granule_id: newGranule.granuleId,
      collection_cumulus_id: t.context.collectionCumulusId,
    }
  );

  const granulesExecutionsPgRecord = await granulesExecutionsPgModel.search(
    t.context.knex,
    {
      granule_cumulus_id: granuleCumulusId,
    }
  );

  const executionPgRecord = await executionPgModel.searchByCumulusIds(
    t.context.knex,
    granulesExecutionsPgRecord[0].execution_cumulus_id
  );

  t.deepEqual(JSON.parse(response.text), {
    message: `Successfully associated execution ${requestPayload.executionArn} with granule granuleId ${requestPayload.granuleId} collectionId ${requestPayload.collectionId}`,
  });

  t.is(fetchedDynamoRecord.execution, t.context.executionUrl);
  t.is(fetchedDynamoRecord.createdAt, fetchedPostgresRecord.created_at.getTime());
  t.is(fetchedDynamoRecord.updatedAt, fetchedPostgresRecord.updated_at.getTime());
  t.is(fetchedDynamoRecord.timestamp, fetchedPostgresRecord.timestamp.getTime());
  t.is(executionPgRecord[0].arn, requestPayload.executionArn);
});

test.serial('associateExecution (POST) associates an execution with a granule', async (t) => {
  const timestamp = Date.now();
  const createdAt = timestamp - 1000000;
  const newGranule = fakeGranuleFactoryV2({
    collectionId: t.context.collectionId,
    createdAt,
    timestamp,
    execution: undefined,
  });

  await request(app)
    .post('/granules')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .set('Accept', 'application/json')
    .send(newGranule)
    .expect(200);

  const requestPayload = {
    collectionId: t.context.collectionId,
    executionArn: t.context.executionArn,
    granuleId: newGranule.granuleId,
  };

  const response = await request(app)
    .post(`/granules/${newGranule.granuleId}/executions`)
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .set('Accept', 'application/json')
    .send(requestPayload)
    .expect(200);

  const fetchedDynamoRecord = await granuleModel.get({
    granuleId: newGranule.granuleId,
  });

  const fetchedPostgresRecord = await granulePgModel.get(
    t.context.knex,
    {
      granule_id: newGranule.granuleId,
      collection_cumulus_id: t.context.collectionCumulusId,
    }
  );

  // get execution for this record.
  const granuleCumulusId = await granulePgModel.getRecordCumulusId(
    t.context.knex,
    {
      granule_id: newGranule.granuleId,
      collection_cumulus_id: t.context.collectionCumulusId,
    }
  );

  const granulesExecutionsPgRecord = await granulesExecutionsPgModel.search(
    t.context.knex,
    {
      granule_cumulus_id: granuleCumulusId,
    }
  );

  const executionPgRecord = await executionPgModel.searchByCumulusIds(
    t.context.knex,
    granulesExecutionsPgRecord[0].execution_cumulus_id
  );

  t.deepEqual(JSON.parse(response.text), {
    message: `Successfully associated execution ${requestPayload.executionArn} with granule granuleId ${requestPayload.granuleId} collectionId ${requestPayload.collectionId}`,
  });

  t.is(fetchedDynamoRecord.execution, t.context.executionUrl);
  t.is(fetchedDynamoRecord.createdAt, fetchedPostgresRecord.created_at.getTime());
  t.is(fetchedDynamoRecord.updatedAt, fetchedPostgresRecord.updated_at.getTime());
  t.is(fetchedDynamoRecord.timestamp, fetchedPostgresRecord.timestamp.getTime());
  t.is(executionPgRecord[0].arn, requestPayload.executionArn);
});

test.serial('associateExecution (POST) returns Not Found if execution does not exist', async (t) => {
  const newGranule = fakeGranuleFactoryV2({
    collectionId: t.context.collectionId,
    execution: undefined,
  });

  await request(app)
    .post('/granules')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .set('Accept', 'application/json')
    .send(newGranule)
    .expect(200);

  const executionArn = randomId('executionArn');
  const requestPayload = {
    collectionId: t.context.collectionId,
    executionArn,
    granuleId: newGranule.granuleId,
  };

  const response = await request(app)
    .post(`/granules/${newGranule.granuleId}/executions`)
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .set('Accept', 'application/json')
    .send(requestPayload)
    .expect(404);

  t.is(response.body.error, 'Not Found');
  t.is(response.body.message, `No execution found to associate granule with for executionArn ${executionArn}`);
});

test.serial('associateExecution (POST) returns Not Found if collectionId in payload does not match the granule record', async (t) => {
  const newGranule = fakeGranuleFactoryV2({
    collectionId: t.context.collectionId,
    execution: undefined,
  });

  await request(app)
    .post('/granules')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .set('Accept', 'application/json')
    .send(newGranule)
    .expect(200);

  const collectionId = `fake_collection___${randomId('collectionId')}`;
  const requestPayload = {
    collectionId,
    executionArn: t.context.executionArn,
    granuleId: newGranule.granuleId,
  };

  const response = await request(app)
    .post(`/granules/${newGranule.granuleId}/executions`)
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .set('Accept', 'application/json')
    .send(requestPayload)
    .expect(404);

  t.is(response.body.error, 'Not Found');
  t.true(response.body.message.includes(`No collection found to associate execution with for collectionId ${collectionId}`));
});

test.serial('PUT replaces an existing granule in all data stores, removing existing fields if not specified', async (t) => {
  const {
    esClient,
    executionPgRecord,
    executionUrl,
    knex,
  } = t.context;
  console.log('foobar');
  const {
    newPgGranule,
    newDynamoGranule,
    esRecord,
  } = await createGranuleAndFiles({
    dbClient: knex,
    esClient,
    executionCumulusId: executionPgRecord.cumulus_id,
    granuleParams: {
      beginningDateTime: new Date().toISOString(),
      cmrLink: 'example.com',
      createdAt: Date.now(),
      duration: 1000,
      endingDateTime: new Date().toISOString(),
      error: { errorKey: 'errorValue' },
      execution: executionUrl,
      lastUpdateDateTime: new Date().toISOString(),
      processingEndDateTime: new Date().toISOString(),
      processingStartDateTime: new Date().toISOString(),
      productionDateTime: new Date().toISOString(),
      productVolume: '1000',
      published: true,
      queryFields: { queryFieldsKey: 'queryFieldsValue' },
      status: 'completed',
      timestamp: 1,
      timeToArchive: 1000,
      timeToPreprocess: 1000,
      updatedAt: Date.now(),
    },
  });

  console.log(esRecord);
  const newGranule = {
    granuleId: newDynamoGranule.granuleId,
    collectionId: newDynamoGranule.collectionId,
    status: 'completed',
  };

  await request(app)
    .put(`/granules/${newDynamoGranule.granuleId}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(newGranule)
    .expect(200); // 200 should be expected for *update*

  const actualGranule = await t.context.granuleModel.get({
    granuleId: newDynamoGranule.granuleId,
  });

  const expectedGranule = {
    ...newGranule,
    error: {}, // This is a default value for no execution
    published: false, // This is a default value
    execution: newDynamoGranule.execution, // This should not have changed
    status: 'completed',
    timestamp: actualGranule.timestamp,
    updatedAt: actualGranule.updatedAt,
    createdAt: actualGranule.createdAt,
  };

  const actualPgGranule = await t.context.granulePgModel.get(t.context.knex, {
    cumulus_id: newPgGranule.cumulus_id,
  });
  const translatedActualPgGranule = await translatePostgresGranuleToApiGranule({
    knexOrTransaction: knex,
    granulePgRecord: actualPgGranule,
  });

  const updatedEsRecord = await t.context.esGranulesClient.get(
    newDynamoGranule.granuleId
  );

  t.deepEqual(actualGranule, expectedGranule);
  // Files is always returned as '[]' by translator if none exist
  t.deepEqual(
    { ...translatedActualPgGranule },
    { ...expectedGranule, files: [] }
  );
  t.deepEqual(updatedEsRecord, { ...expectedGranule, _id: updatedEsRecord._id });
});

test.serial('PUT creates a new granule in all data stores', async (t) => {
  const {
    collectionId,
    collectionCumulusId,
    createGranuleId,
    knex,
  } = t.context;

  const granuleId = createGranuleId();
  const newGranule = {
    granuleId,
    collectionId,
    status: 'completed',
  };

  await request(app)
    .put(`/granules/${granuleId}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(newGranule)
    .expect(201); // 201 should be expected for *create*

  const actualGranule = await t.context.granuleModel.get({ granuleId });

  const expectedGranule = {
    ...newGranule,
    error: {}, // This is a default value for no execution
    published: false, // This is a default value
    timestamp: actualGranule.timestamp,
    updatedAt: actualGranule.updatedAt,
    createdAt: actualGranule.createdAt,
  };

  const actualPgGranule = await t.context.granulePgModel.get(t.context.knex, {
    collection_cumulus_id: collectionCumulusId,
    granule_id: granuleId,
  });
  const translatedActualPgGranule = await translatePostgresGranuleToApiGranule({
    knexOrTransaction: knex,
    granulePgRecord: actualPgGranule,
  });
  const updatedEsRecord = await t.context.esGranulesClient.get(granuleId);

  t.deepEqual(actualGranule, expectedGranule);
  // Files is always returned as '[]' via translator
  t.deepEqual(
    { ...translatedActualPgGranule },
    { ...expectedGranule, files: [] }
  );
  t.deepEqual(updatedEsRecord, { ...expectedGranule, _id: updatedEsRecord._id });
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

test.only('PUT returns 400 for version value less than the configured value', async (t) => {
  const granuleId = t.context.createGranuleId();
  const response = await request(app)
    .put(`/granules/${granuleId}`)
    .set('version', '0')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send({})
    .expect(400);
  t.is(response.status, 400);
  t.true(response.text.includes("This API endpoint requires 'version' header"));
});

test.only('PATCH returns 400 for version value less than the configured value', async (t) => {
  const granuleId = t.context.createGranuleId();
  const response = await request(app)
    .patch(`/granules/${granuleId}`)
    .set('version', '0')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send({})
    .expect(400);
  t.is(response.status, 400);
  t.true(response.text.includes("This API endpoint requires 'version' header"));
});
