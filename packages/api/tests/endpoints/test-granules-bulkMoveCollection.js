'use strict';

const sinon = require('sinon');
const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const {
  CollectionPgModel,
  destroyLocalTestDb,
  fakeCollectionRecordFactory,
  fakeGranuleRecordFactory,
  generateLocalTestDb,
  GranulePgModel,
  localStackConnectionEnv,
  migrationDir,
  translatePostgresGranuleToApiGranule,
  upsertGranuleWithExecutionJoinRecord,
} = require('@cumulus/db');
const { ExecutionAlreadyExists } = require('@cumulus/aws-client/StepFunctions');
const { createTestIndex, cleanupTestIndex } = require('@cumulus/es-client/testUtils');
const {
  createBucket,
  recursivelyDeleteS3Bucket,
  s3PutObject,
} = require('@cumulus/aws-client/S3');
const indexer = require('@cumulus/es-client/indexer');
const { Search } = require('@cumulus/es-client/search');
const { randomId } = require('@cumulus/common/test-utils');
const { constructCollectionId, deconstructCollectionId } = require('@cumulus/message/Collections');

const { bulkMoveCollection } = require('../../endpoints/granules');

const { buildFakeExpressResponse } = require('./utils');

const testDbName = `granules_${cryptoRandomString({ length: 10 })}`;

let granulePgModel;

process.env.AccessTokensTable = randomId('token');
process.env.stackName = randomId('stackname');
process.env.system_bucket = randomId('system-bucket');
process.env.TOKEN_SECRET = randomId('secret');
process.env.backgroundQueueUrl = randomId('backgroundQueueUrl');

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
  await s3PutObject({
    Bucket: process.env.system_bucket,
    Key: tKey,
    Body: JSON.stringify({
      cumulus_meta: {
        cumulus_version: 'fakeVersion',
      },
    }),
  });

  // create a workflowKey
  // TODO use actual workflow name
  const workflowKey = `${process.env.stackName}/workflows/MoveGranuleCollectionsWorkflow.json`;

  t.context.workflowArn = 'fakeWorkflow';
  await s3PutObject({
    Bucket: process.env.system_bucket,
    Key: workflowKey,
    Body: JSON.stringify({
      arn: t.context.workflowArn,
    }),
  });

  granulePgModel = new GranulePgModel();
  t.context.granulePgModel = granulePgModel;

  // Generate a local test postGres database
  const { knex, knexAdmin } = await generateLocalTestDb(testDbName, migrationDir);
  t.context.knex = knex;
  t.context.knexAdmin = knexAdmin;

  const { esIndex, esClient } = await createTestIndex();
  t.context.esIndex = esIndex;
  t.context.esClient = esClient;

  t.context.esGranulesClient = new Search({}, 'granule', process.env.ES_INDEX);
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
  t.context.collectionCumulusId = pgCollection.cumulus_id;
  t.context.collectionCumulusId2 = pgCollection2.cumulus_id;

  t.context.collectionId = constructCollectionId(pgCollection.name, pgCollection.version);
  t.context.collectionId2 = constructCollectionId(pgCollection2.name, pgCollection2.version);
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
});

test.after.always(async (t) => {
  await recursivelyDeleteS3Bucket(process.env.system_bucket);

  await destroyLocalTestDb({
    knex: t.context.knex,
    knexAdmin: t.context.knexAdmin,
    testDbName,
  });
  await cleanupTestIndex(t.context);
});

test.serial('bulkMoveCollection generates the proper payload and calls startExecution with it', async (t) => {
  process.env.CUMULUS_VERSION = 'fakeVersion';
  const { collectionPgModel, knex, workflowArn } = t.context;
  const newCollection = fakeCollectionRecordFactory();
  await collectionPgModel.create(knex, newCollection);

  const { fakePGGranules } = t.context;
  const granuleIds = fakePGGranules.map((g) => {
    if (g.collection_cumulus_id === t.context.collectionCumulusId) {
      return g.granule_id;
    }
    return undefined;
  }).filter((g) => g !== undefined);

  const response = buildFakeExpressResponse();

  const startExecutionStub = sinon.stub();
  startExecutionStub.returns({
    executionArn: 'fakeArn',
  });
  const sfnMethod = () => ({
    startExecution: startExecutionStub,
  });

  const testBodyValues = {
    invalidBehavior: 'error',
    s3MultipartChunkSizeMb: 500,
    batchSize: 200,
    concurrency: 50,
  };

  await bulkMoveCollection({
    testContext: { knex, sfnMethod },
    body: {
      sourceCollectionId: t.context.collectionId,
      targetCollectionId: t.context.collectionId2,
      ...testBodyValues,
    },
  }, response);
  const expected = {
    execution: 'fakeArn',
    message: `Successfully submitted bulk granule move collection with ${granuleIds.length} granules`,
  };

  const expectedPayload = {
    cumulus_meta: {
      state_machine: workflowArn,
      cumulus_version: 'fakeVersion',
    },
    meta: {
      bulkMoveCollection: {
        ...testBodyValues,
        targetCollection: deconstructCollectionId(t.context.collectionId2),
      },
    },
    payload: {
      granuleIds: granuleIds.sort(),
    },
  };

  const actualPayload = JSON.parse(startExecutionStub.getCall(0).args[0].input);
  t.like(actualPayload, expectedPayload, 'StartExecution should match');
  t.truthy(actualPayload.cumulus_meta.execution_name);
  t.truthy(actualPayload.cumulus_meta.workflow_start_time);
  t.deepEqual(response.send.getCall(0).args[0], expected, 'Endpoint response should match');
});

test.serial('bulkMoveCollection handles ExecutionAlreadyExists error correctly', async (t) => {
  const { knex, workflowArn } = t.context;
  const req = {
    body: {
      batchSize: 100,
      concurrency: 10,
      invalidBehavior: 'error',
      sourceCollectionId: t.context.collectionId,
      targetCollectionId: t.context.collectionId2,
    },
    testContext: {
      knex,
      sfnMethod: () => ({
        startExecution: sinon.stub().throws(new ExecutionAlreadyExists('Execution already exists')),
      }),
    },
  };

  const res = {
    boom: {
      badRequest: sinon.stub(),
    },
    send: sinon.stub(),
  };

  await bulkMoveCollection(req, res);
  t.true(res.boom.badRequest.firstCall.args[0].includes(`already exists for state machine ${workflowArn}`));
});

test.serial('bulkMoveCollection handles a missing workflow configuration file correctly', async (t) => {
  const { knex } = t.context;
  const startExecutionStub = sinon.stub();
  startExecutionStub.returns({
    executionArn: 'fakeArn',
  });
  const sfnMethod = () => ({
    startExecution: startExecutionStub,
  });
  const req = {
    body: {
      batchSize: 100,
      concurrency: 10,
      invalidBehavior: 'error',
      sourceCollectionId: t.context.collectionId,
      targetCollectionId: t.context.collectionId2,
    },
    testContext: {
      knex,
      sfnMethod,
      workflow: 'someDumbWorkflow',
    },
  };
  const res = {
    boom: {
      badRequest: sinon.stub(),
    },
    send: sinon.stub(),
  };
  await bulkMoveCollection(req, res);
  t.is('Unable to find state machine ARN for workflow someDumbWorkflow', res.boom.badRequest.firstCall.args[0], 'Error message should match catch for getJsonS3Object');
});
