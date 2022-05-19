'use strict';

const fs = require('fs');
const request = require('supertest');
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
  FilePgModel,
  generateLocalTestDb,
  getUniqueGranuleByGranuleId,
  GranulePgModel,
  GranulesExecutionsPgModel,
  localStackConnectionEnv,
  migrationDir,
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
const { Search, multipleRecordFoundString } = require('@cumulus/es-client/search');
const launchpad = require('@cumulus/launchpad-auth');
const { randomString, randomId } = require('@cumulus/common/test-utils');
const { getBucketsConfigKey } = require('@cumulus/common/stack');
const { getDistributionBucketMapKey } = require('@cumulus/distribution-utils');
const { constructCollectionId } = require('@cumulus/message/Collections');

const { put, del } = require('../../endpoints/granules');
const assertions = require('../../lib/assertions');
const { createGranuleAndFiles } = require('../helpers/create-test-data');
const models = require('../../models');

// Dynamo mock data factories
const {
  createFakeJwtAuthToken,
  fakeAccessTokenFactory,
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
let executionPgModel;
let filePgModel;
let granulePgModel;
let granulesExecutionsPgModel;
let jwtAuthToken;

process.env.AccessTokensTable = randomId('token');
process.env.AsyncOperationsTable = randomId('async');
process.env.ExecutionsTable = randomId('executions');
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

  // Create collections in Postgres
  // we need this because a granule has a foreign key referring to collections
  const collectionName = 'fakeCollection';
  const collectionVersion = 'v1';

  t.context.collectionId = constructCollectionId(
    collectionName,
    collectionVersion
  );

  const testPgCollection = fakeCollectionRecordFactory({
    name: collectionName,
    version: collectionVersion,
  });
  const collectionPgModel = new CollectionPgModel();
  const [pgCollection] = await collectionPgModel.create(
    t.context.knex,
    testPgCollection
  );

  // Create execution in Postgres
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

  const executionPgRecord = await translateApiExecutionToPostgresExecution(
    newExecution,
    knex
  );
  await executionPgModel.create(knex, executionPgRecord);
  t.context.executionUrl = executionPgRecord.url;
  t.context.executionArn = executionPgRecord.arn;
});

test.beforeEach(async (t) => {
  const granuleId1 = `${cryptoRandomString({ length: 7 })}.${cryptoRandomString({ length: 20 })}.hdf`;
  const granuleId2 = `${cryptoRandomString({ length: 7 })}.${cryptoRandomString({ length: 20 })}.hdf`;

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

  const insertedPgGranules = await Promise.all(
    t.context.fakePGGranules.map((granule) =>
      upsertGranuleWithExecutionJoinRecord(
        t.context.knex,
        granule,
        t.context.testExecutionCumulusId,
        t.context.granulePgModel
      ))
  );
  t.context.insertedPgGranules = insertedPgGranules.flat();
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

test.serial('default returns list of granules', async (t) => {
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
  const granuleIds = t.context.fakePGGranules.map((i) => i.granule_id);
  results.forEach((r) => {
    t.true(granuleIds.includes(r.granuleId));
  });
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

test.serial('CUMULUS-911 PUT with pathParameters.granuleName set and without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .put('/granules/asdf')
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
    .put('/granules/asdf')
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

test.serial('PUT fails if action is not supported', async (t) => {
  const response = await request(app)
    .put(`/granules/${t.context.fakePGGranules[0].granule_id}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send({ action: 'someUnsupportedAction' })
    .expect(400);

  t.is(response.status, 400);
  const { message } = response.body;
  t.true(message.includes('Action is not supported'));
});

test.serial('PUT without a body, fails to update granule.', async (t) => {
  const response = await request(app)
    .put(`/granules/${t.context.fakePGGranules[0].granule_id}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(400);

  t.is(response.status, 400);
  const { message } = response.body;
  t.is(message, `input :granuleName (${t.context.fakePGGranules[0].granule_id}) must match body's granuleId (undefined)`);
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
    .put(`/granules/${t.context.fakePGGranules[0].granule_id}`)
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
  t.is(updatedPgGranule.status, 'queued');
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
    .put(`/granules/${t.context.fakePGGranules[0].granule_id}`)
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

  t.is(updatedPgGranule.status, 'queued');
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
      .put(`/granules/${granuleId}`)
      .set('Accept', 'application/json')
      .set('Authorization', `Bearer ${jwtAuthToken}`)
      .send({ action: 'removeFromCmr' })
      .expect(200);

    const body = response.body;
    t.is(body.status, 'SUCCESS');
    t.is(body.action, 'removeFromCmr');

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
      .put(`/granules/${t.context.fakePGGranules[0].granule_id}`)
      .set('Accept', 'application/json')
      .set('Authorization', `Bearer ${jwtAuthToken}`)
      .send({ action: 'removeFromCmr' })
      .expect(200);

    const body = response.body;
    t.is(body.status, 'SUCCESS');
    t.is(body.action, 'removeFromCmr');

    const updatedGranule = await granulePgModel.get(t.context.knex, {
      granule_id: t.context.fakePGGranules[0].granule_id,
      collection_cumulus_id: t.context.collectionCumulusId,
    });

    t.is(updatedGranule.published, false);
    t.is(updatedGranule.cmr_link, null);

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

  const collectionPgModel = new CollectionPgModel();
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
  const newPgGranule = await translateApiGranuleToPostgresGranule(newGranule, knex);
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
  const { detail } = response.body;
  t.is(detail, 'Record deleted');

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

  const collectionPgModel = new CollectionPgModel();
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
  const { detail } = response.body;
  t.is(detail, 'Record deleted');

  t.false(await esGranulesClient.exists(newGranule.granuleId));
});

test.serial('del() fails to delete a granule that has multiple entries in Elasticsearch, but no records in PostgreSQL', async (t) => {
  const {
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

  const collectionPgModel = new CollectionPgModel();
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

  t.false(await granulePgModel.exists(
    knex,
    {
      granule_id: newGranule.granuleId,
      collection_cumulus_id: pgCollection.cumulus_id,
    }
  ));

  const expressRequest = {
    params: {
      granuleName: newGranule.granuleId,
    },
    testContext: {
      esGranulesClient: {
        get: () => ({ detail: multipleRecordFoundString }),
      },
    },
  };
  const response = buildFakeExpressResponse();

  await del(expressRequest, response);
  t.true(response.boom.notFound.called);
});

test.serial('DELETE deleting an existing granule that is published will fail and not delete records', async (t) => {
  const {
    s3Buckets,
    newPgGranule,
  } = await createGranuleAndFiles({
    dbClient: t.context.knex,
    granuleParams: { published: true },
    esClient: t.context.esClient,
  });

  const collectionCumulusId = newPgGranule.collection_cumulus_id;

  const newApiGranule = await translatePostgresGranuleToApiGranule({
    granulePgRecord: newPgGranule,
    knexOrTransaction: t.context.knex,
  });

  const granuleId = newApiGranule.granuleId;

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

  // granule should still exist in Postgres
  t.true(await granulePgModel.exists(
    t.context.knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  ));

  // Verify files still exist in S3 and Postgres
  await Promise.all(
    newApiGranule.files.map(async (file) => {
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
    newPgGranule,
  } = await createGranuleAndFiles({
    dbClient: t.context.knex,
    granuleParams: { published: false },
    esClient: t.context.esClient,
  });

  const collectionCumulusId = newPgGranule.collection_cumulus_id;

  const newApiGranule = await translatePostgresGranuleToApiGranule({
    granulePgRecord: newPgGranule,
    knexOrTransaction: t.context.knex,
  });

  const response = await request(app)
    .delete(`/granules/${newApiGranule.granuleId}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  t.is(response.status, 200);
  const { detail } = response.body;
  t.is(detail, 'Record deleted');

  const granuleId = newApiGranule.granuleId;

  // granule has been deleted from Postgres
  t.false(await granulePgModel.exists(
    t.context.knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  ));

  // verify the files are deleted from S3 and Postgres
  await Promise.all(
    newApiGranule.files.map(async (file) => {
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
  const { knex } = t.context;
  const {
    s3Buckets,
    newPgGranule,
  } = await createGranuleAndFiles({
    dbClient: t.context.knex,
    esClient: t.context.esClient,
    granuleParams: { published: true },
  });

  const collectionCumulusId = newPgGranule.collection_cumulus_id;

  const newApiGranule = await translatePostgresGranuleToApiGranule({
    granulePgRecord: newPgGranule,
    knexOrTransaction: knex,
  });

  sinon
    .stub(GranulePgModel.prototype, 'get')
    .throws(new Error('Error message'));

  try {
    const response = await request(app)
      .delete(`/granules/${newApiGranule.granuleId}`)
      .set('Accept', 'application/json')
      .set('Authorization', `Bearer ${jwtAuthToken}`);
    t.is(response.status, 400);
  } finally {
    GranulePgModel.prototype.get.restore();
  }

  const granuleId = newApiGranule.granuleId;

  // granule has not been deleted from Postgres
  t.true(await granulePgModel.exists(
    t.context.knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  ));

  // verify the files still exist in S3 and Postgres
  await Promise.all(
    newApiGranule.files.map(async (file) => {
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
  const { knex } = t.context;
  const {
    s3Buckets,
    newPgGranule,
  } = await createGranuleAndFiles({
    dbClient: t.context.knex,
    esClient: t.context.esClient,
    granuleParams: { published: false },
  });

  const newApiGranule = await translatePostgresGranuleToApiGranule({
    granulePgRecord: newPgGranule,
    knexOrTransaction: knex,
  });

  const timeOfResponse = Date.now();

  const response = await request(app)
    .delete(`/granules/${newApiGranule.granuleId}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  t.is(response.status, 200);
  const { detail } = response.body;
  t.is(detail, 'Record deleted');

  const granuleId = newApiGranule.granuleId;

  // granule have been deleted from Postgres and Dynamo
  t.false(await granulePgModel.exists(
    t.context.knex,
    {
      granule_id: granuleId,
      collection_cumulus_id: newPgGranule.collection_cumulus_id,
    }
  ));

  // verify the files are deleted from S3 and Postgres
  await Promise.all(
    newApiGranule.files.map(async (file) => {
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

  t.is(publishedMessage.record.granuleId, newApiGranule.granuleId);
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
        .put(`/granules/${newGranule.granuleId}`)
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

test.serial('When a move granule request fails to move a file correctly, it records the expected granule files in postgres', async (t) => {
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
        .put(`/granules/${newGranule.granuleId}`)
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

  const postgresNewGranule = await translateApiGranuleToPostgresGranule(
    newGranule,
    t.context.knex
  );
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
    .put(`/granules/${newGranule.granuleId}`)
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

  const postgresNewGranule = await translateApiGranuleToPostgresGranule(
    newGranule,
    t.context.knex
  );
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
    .put(`/granules/${newGranule.granuleId}`)
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

test.serial('PUT with action move returns failure if one granule file exists', async (t) => {
  const getFilesExistingAtLocationMethod = () => Promise.resolve([{ fileName: 'file1' }]);
  const { knex, insertedPgGranules } = t.context;

  await translatePostgresGranuleToApiGranule({
    knexOrTransaction: knex,
    granulePgRecord: insertedPgGranules[0],
  });

  const body = {
    action: 'move',
    destinations: [{
      regex: '.*.hdf$',
      bucket: 'fake-bucket',
      filepath: 'fake-destination',
    }],
  };

  const expressRequest = {
    params: {
      granuleName: insertedPgGranules[0].granule_id,
    },
    body,
    testContext: {
      knex,
      getFilesExistingAtLocationMethod,
    },
  };

  const expressResponse = buildFakeExpressResponse();
  await put(expressRequest, expressResponse);
  t.true(expressResponse.boom.conflict.called);
  t.is(expressResponse.boom.conflict.args[0][0],
    'Cannot move granule because the following files would be overwritten at the destination location: file1. Delete the existing files or reingest the source files.');
});

test.serial('put() with action move returns failure if more than one granule file exists', async (t) => {
  const getFilesExistingAtLocationMethod = () => Promise.resolve([
    { fileName: 'file1' },
    { fileName: 'file2' },
    { fileName: 'file3' },
  ]);

  const { insertedPgGranules, knex } = t.context;

  const body = {
    action: 'move',
    destinations: [{
      regex: '.*.hdf$',
      bucket: 'fake-bucket',
      filepath: 'fake-destination',
    }],
  };

  const expressRequest = {
    params: {
      granuleName: insertedPgGranules[0].granule_id,
    },
    body,
    testContext: {
      knex,
      getFilesExistingAtLocationMethod,
    },
  };

  const expressResponse = buildFakeExpressResponse();
  await put(expressRequest, expressResponse);
  t.true(expressResponse.boom.conflict.called);
  t.is(expressResponse.boom.conflict.args[0][0],
    'Cannot move granule because the following files would be overwritten at the destination location: file1, file2, file3. Delete the existing files or reingest the source files.');
});

test.serial('create (POST) creates new granule without an execution in PostgreSQL, and Elasticsearch', async (t) => {
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
  t.is(fetchedPostgresRecord.granule_id, newGranule.granuleId);
  t.is(fetchedESRecord.granuleId, newGranule.granuleId);
});

test.serial('create (POST) creates new granule with associated execution in PostgreSQL and Elasticsearch', async (t) => {
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
  t.is(errorText.message, `A granule already exists for granule_id: ${newGranule.granuleId}`);
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

test.serial('PUT replaces an existing granule in all data stores', async (t) => {
  const {
    esClient,
    executionUrl,
    knex,
  } = t.context;
  const timestamp = Date.now();
  const {
    newPgGranule,
    esRecord,
  } = await createGranuleAndFiles({
    dbClient: knex,
    esClient,
    granuleParams: {
      status: 'running',
      execution: executionUrl,
      timestamp: Date.now(),
    },
  });
  const newApiGranule = await translatePostgresGranuleToApiGranule({
    granulePgRecord: newPgGranule,
    knexOrTransaction: knex,
  });

  t.is(newPgGranule.status, 'running');
  t.is(newPgGranule.query_fields, null);
  t.is(esRecord.status, 'running');
  t.is(esRecord.queryFields, undefined);

  const newQueryFields = {
    foo: randomString(),
  };
  const updatedGranule = {
    ...newApiGranule,
    status: 'completed',
    queryFields: newQueryFields,
    timestamp,
  };

  await request(app)
    .put(`/granules/${newApiGranule.granuleId}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(updatedGranule)
    .expect(200);

  const actualPgGranule = await t.context.granulePgModel.get(t.context.knex, {
    cumulus_id: newPgGranule.cumulus_id,
  });

  const actualApiGranule = await translatePostgresGranuleToApiGranule({
    granulePgRecord: actualPgGranule,
    knexOrTransaction: knex,
  });

  t.deepEqual(actualPgGranule, {
    ...newPgGranule,
    timestamp: new Date(timestamp),
    status: 'completed',
    query_fields: newQueryFields,
    updated_at: actualPgGranule.updated_at,
    error: {},
    last_update_date_time: actualPgGranule.last_update_date_time,
    beginning_date_time: actualPgGranule.beginning_date_time,
    ending_date_time: actualPgGranule.ending_date_time,
    production_date_time: actualPgGranule.production_date_time,
  });

  const updatedEsRecord = await t.context.esGranulesClient.get(
    newApiGranule.granuleId
  );
  t.like(
    updatedEsRecord,
    {
      ...esRecord,
      files: actualApiGranule.files,
      status: 'completed',
      queryFields: newQueryFields,
      updatedAt: updatedEsRecord.updatedAt,
      timestamp: updatedEsRecord.timestamp,
    }
  );
});

test.serial('PUT replaces an existing granule in all data stores with correct timestamps', async (t) => {
  const {
    esClient,
    executionUrl,
    knex,
  } = t.context;
  const {
    newPgGranule,
  } = await createGranuleAndFiles({
    dbClient: knex,
    esClient,
    granuleParams: {
      status: 'running',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      execution: executionUrl,
    },
  });

  const newApiGranule = await translatePostgresGranuleToApiGranule({
    granulePgRecord: newPgGranule,
    knexOrTransaction: knex,
  });

  const updatedGranule = {
    ...newApiGranule,
    updatedAt: Date.now(),
    status: 'completed',
  };

  await request(app)
    .put(`/granules/${newApiGranule.granuleId}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(updatedGranule)
    .expect(200);

  const actualPgGranule = await t.context.granulePgModel.get(t.context.knex, {
    cumulus_id: newPgGranule.cumulus_id,
  });
  const updatedEsRecord = await t.context.esGranulesClient.get(
    newApiGranule.granuleId
  );

  // createdAt timestamp from original record should have been preserved
  t.is(actualPgGranule.createdAt, newPgGranule.createdAt);
  // PG and ES records have the same timestamps
  t.is(actualPgGranule.created_at.getTime(), updatedEsRecord.createdAt);
  t.is(actualPgGranule.updated_at.getTime(), updatedEsRecord.updatedAt);
});

test.serial('PUT publishes an SNS message after a successful granule update', async (t) => {
  const {
    collectionCumulusId,
    esClient,
    executionUrl,
    knex,
  } = t.context;
  const {
    newPgGranule,
  } = await createGranuleAndFiles({
    dbClient: knex,
    esClient,
    granuleParams: {
      status: 'running',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      execution: executionUrl,
    },
    collection_cumulus_id: collectionCumulusId,
  });

  const newApiGranule = await translatePostgresGranuleToApiGranule({
    granulePgRecord: newPgGranule,
    knexOrTransaction: knex,
  });

  const updatedGranule = {
    ...newApiGranule,
    updatedAt: Date.now(),
    createdAt: Date.now(),
  };

  await request(app)
    .put(`/granules/${newApiGranule.granuleId}`)
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

test.serial('put() does not write to Elasticsearch/SNS if writing to PostgreSQL fails', async (t) => {
  const {
    esClient,
    executionUrl,
    knex,
  } = t.context;
  const {
    newPgGranule,
    esRecord,
  } = await createGranuleAndFiles({
    dbClient: knex,
    esClient,
    granuleParams: {
      status: 'running',
      execution: executionUrl,
    },
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

  const apiGranule = await translatePostgresGranuleToApiGranule({
    granulePgRecord: newPgGranule,
    knexOrTransaction: knex,
  });

  const updatedGranule = {
    ...apiGranule,
    status: 'completed',
    granulePgModel: fakeGranulePgModel,
  };

  const expressRequest = {
    params: {
      granuleName: apiGranule.granuleId,
    },
    body: updatedGranule,
    testContext: {
      knex,
      granulePgModel: fakeGranulePgModel,
    },
  };

  const response = buildFakeExpressResponse();
  await put(expressRequest, response);
  t.true(response.boom.badRequest.calledWithMatch('something bad'));

  const actualPgGranule = await t.context.granulePgModel.get(t.context.knex, {
    cumulus_id: newPgGranule.cumulus_id,
  });

  const actualApiGranule = await translatePostgresGranuleToApiGranule({
    granulePgRecord: actualPgGranule,
    knexOrTransaction: knex,
  });

  t.deepEqual(
    await t.context.granulePgModel.get(t.context.knex, {
      cumulus_id: newPgGranule.cumulus_id,
    }),
    newPgGranule
  );
  t.deepEqual(
    await t.context.esGranulesClient.get(
      actualApiGranule.granuleId
    ),
    esRecord
  );

  const { Messages } = await sqs().receiveMessage({
    QueueUrl: t.context.QueueUrl,
    WaitTimeSeconds: 10,
  }).promise();
  t.is(Messages, undefined);
});

test.serial('put() rolls back PostgreSQL records and does not write to SNS if writing to Elasticsearch fails', async (t) => {
  const {
    esClient,
    executionUrl,
    knex,
  } = t.context;
  const {
    newPgGranule,
    esRecord,
  } = await createGranuleAndFiles({
    dbClient: knex,
    esClient,
    granuleParams: { status: 'running', execution: executionUrl },
  });

  const fakeEsClient = {
    update: () => {
      throw new Error('something bad');
    },
    delete: () => Promise.resolve(),
  };
  const apiGranule = await translatePostgresGranuleToApiGranule({
    granulePgRecord: newPgGranule,
    knexOrTransaction: knex,
  });

  const updatedGranule = {
    ...apiGranule,
    status: 'completed',
  };

  const expressRequest = {
    params: {
      granuleName: apiGranule.granuleId,
    },
    body: updatedGranule,
    testContext: {
      knex,
      esClient: fakeEsClient,
    },
  };

  const response = buildFakeExpressResponse();

  await put(expressRequest, response);
  t.true(response.boom.badRequest.calledWithMatch('something bad'));

  const actualPgGranule = await t.context.granulePgModel.get(t.context.knex, {
    cumulus_id: newPgGranule.cumulus_id,
  });

  t.deepEqual(
    actualPgGranule,
    newPgGranule
  );
  t.deepEqual(
    await t.context.esGranulesClient.get(
      apiGranule.granuleId
    ),
    esRecord
  );

  const { Messages } = await sqs().receiveMessage({
    QueueUrl: t.context.QueueUrl,
    WaitTimeSeconds: 10,
  }).promise();
  t.is(Messages, undefined);
});

test.serial('PUT adds granule if it does not exist', async (t) => {
  const newGranule = fakeGranuleFactoryV2({
    collectionId: t.context.collectionId,
    execution: undefined,
  });

  const response = await request(app)
    .put(`/granules/${newGranule.granuleId}`)
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .set('Accept', 'application/json')
    .send(newGranule)
    .expect(201);

  t.deepEqual(JSON.parse(response.text), {
    message: `Successfully wrote granule with Granule Id: ${newGranule.granuleId}, Collection Id: ${newGranule.collectionId}`,
  });

  const fetchedPostgresRecord = await granulePgModel.get(
    t.context.knex,
    {
      granule_id: newGranule.granuleId,
      collection_cumulus_id: t.context.collectionCumulusId,
    }
  );

  t.is(fetchedPostgresRecord.granule_id, newGranule.granuleId);
});

test.serial('PUT returns an updated granule with an undefined execution', async (t) => {
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
    .put(`/granules/${newGranule.granuleId}`)
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .set('Accept', 'application/json')
    .send(modifiedGranule)
    .expect(200);

  t.is(modifiedResponse.statusCode, 200);

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

  t.is(fetchedPostgresRecord.status, 'failed');
  t.deepEqual(fetchedPostgresRecord.error, { some: 'error' });
});

test.serial('PUT returns an updated granule with associated execution', async (t) => {
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
    .put(`/granules/${newGranule.granuleId}`)
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .set('Accept', 'application/json')
    .send(modifiedGranule)
    .expect(200);

  t.is(modifiedResponse.statusCode, 200);

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

  t.is(fetchedPostgresRecord.status, 'failed');
  t.deepEqual(fetchedPostgresRecord.error, { some: 'error' });
  t.is(executionPgRecord[0].url, modifiedGranule.execution);
});

test.serial('PUT returns bad request when the path param granuleName does not match the json granuleId', async (t) => {
  const newGranule = fakeGranuleFactoryV2({});
  const granuleName = `granuleName_${cryptoRandomString({ length: 10 })}`;

  const { body } = await request(app)
    .put(`/granules/${granuleName}`)
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .set('Accept', 'application/json')
    .send(newGranule)
    .expect(400);

  t.is(body.statusCode, 400);
  t.is(body.error, 'Bad Request');
  t.is(body.message, `input :granuleName (${granuleName}) must match body's granuleId (${newGranule.granuleId})`);
});

test.serial('update (PUT) can set running granule status to queued', async (t) => {
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
    .put(`/granules/${granuleId}`)
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

// TODO - This needs fixed in 2909/on merge of 2909
/*test.only('PUT will not set completed status to queued', async (t) => {
  const { fakePGGranules, knex, collectionCumulusId } = t.context;
  const granuleId = fakePGGranules[0].granule_id;
  const response = await request(app)
    .put(`/granules/${granuleId}`)
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
    message: `Successfully updated granule with Granule Id:
    ${granuleId}, Collection Id: ${t.context.collectionId}`,
  });
  const fetchedRecord = await granulePgModel.get(
    knex,
    {
      granule_id: granuleId,
      collection_cumulus_id: collectionCumulusId,
    }
  );

  t.is(fetchedRecord.status, 'completed');
});*/

test.serial('PUT will not set completed status to queued when queued created at is older', async (t) => {
  const { fakePGGranules, knex, collectionCumulusId } = t.context;
  const granuleId = fakePGGranules[0].granule_id;
  const response = await request(app)
    .put(`/granules/${granuleId}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send({
      granuleId: granuleId,
      status: 'queued',
      collectionId: t.context.collectionId,
      execution: t.context.executionUrl,
      createdAt: (Date.now() - 100000),
    });

  t.is(response.status, 200);
  t.deepEqual(JSON.parse(response.text), {
    message: `Successfully updated granule with Granule Id: ${granuleId}, Collection Id: ${t.context.collectionId}`,
  });
  const fetchedRecord = await granulePgModel.get(
    knex,
    {
      granule_id: granuleId,
      collection_cumulus_id: collectionCumulusId,
    }
  );

  t.is(fetchedRecord.status, 'completed');
});

test.serial('PUT can create a new granule with status queued', async (t) => {
  const granuleId = randomId('new-granule');
  const response = await request(app)
    .put(`/granules/${granuleId}`)
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
