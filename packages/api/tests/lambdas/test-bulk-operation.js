const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const proxyquire = require('proxyquire');
const sinon = require('sinon');
const omit = require('lodash/omit');

const {
  sns,
  sqs,
} = require('@cumulus/aws-client/services');

const awsServices = require('@cumulus/aws-client/services');
const {
  CollectionPgModel,
  ExecutionPgModel,
  GranulePgModel,
  GranulesExecutionsPgModel,
  fakeCollectionRecordFactory,
  fakeExecutionRecordFactory,
  fakeGranuleRecordFactory,
  generateLocalTestDb,
  getUniqueGranuleByGranuleId,
  destroyLocalTestDb,
  localStackConnectionEnv,
  migrationDir,
  translatePostgresGranuleToApiGranule,
  translateApiGranuleToPostgresGranule,
} = require('@cumulus/db');
const { constructCollectionId } = require('@cumulus/message/Collections');
const { randomId, randomString } = require('@cumulus/common/test-utils');
const { createBucket, deleteS3Buckets } = require('@cumulus/aws-client/S3');
const {
  createTestIndex,
  cleanupTestIndex,
} = require('@cumulus/es-client/testUtils');
const { RecordDoesNotExist } = require('@cumulus/errors');
const { fakeGranuleFactoryV2 } = require('../../lib/testUtils');
const { createGranuleAndFiles } = require('../helpers/create-test-data');
const Granule = require('../../models/granules');

const testDbName = `${cryptoRandomString({ length: 10 })}`;
const randomArn = () => `arn_${cryptoRandomString({ length: 10 })}`;
const randomGranuleId = () => `granuleId_${cryptoRandomString({ length: 10 })}`;
const randomWorkflow = () => `workflow_${cryptoRandomString({ length: 10 })}`;

const sandbox = sinon.createSandbox();
const FakeEsClient = sandbox.stub();
const esSearchStub = sandbox.stub();
const esScrollStub = sandbox.stub();
FakeEsClient.prototype.scroll = esScrollStub;
FakeEsClient.prototype.search = esSearchStub;
class FakeSearch {
  static es() {
    return new FakeEsClient();
  }
}
const bulkOperation = proxyquire('../../lambdas/bulk-operation', {
  '../lib/granules': proxyquire('../../lib/granules', {
    '@cumulus/es-client/search': {
      Search: FakeSearch,
    },
  }),
});

let applyWorkflowStub;
let reingestStub;

const envVars = {
  asyncOperationId: randomId('asyncOperationId'),
  cmr_client_id: randomId('cmr_client'),
  CMR_ENVIRONMENT: randomId('env'),
  cmr_oauth_provider: randomId('cmr_oauth'),
  cmr_password_secret_name: randomId('cmr_secret'),
  cmr_provider: randomId('cmr_provider'),
  cmr_username: randomId('cmr_user'),
  invoke: randomId('invoke'),
  launchpad_api: randomId('api'),
  launchpad_certificate: randomId('certificate'),
  launchpad_passphrase_secret_name: randomId('launchpad_secret'),
  METRICS_ES_HOST: randomId('host'),
  METRICS_ES_USER: randomId('user'),
  METRICS_ES_PASS: randomId('pass'),
  stackName: randomId('stack'),
  system_bucket: randomId('bucket'),
};

/**
 * Sets up test database with granules/executions/and granule_executions so
 * that two granules that are linked to executions that have run the same
 * workflow.
 *
 * Modifies the input object to add the workflowName, executionArns and
 * granuleIds for access during testing.
 *
 * @param {Object} t - Ava test context
 */
const setUpExistingDatabaseRecords = async (t) => {
  t.context.workflowName = randomWorkflow();
  t.context.executionArns = [randomArn(), randomArn()];
  t.context.granuleIds = [randomGranuleId(), randomGranuleId()];
  const collection = fakeCollectionRecordFactory();
  t.context.collectionId = constructCollectionId(collection.name, collection.version);

  const granuleModel = new Granule();
  t.context.granules = await Promise.all(t.context.granuleIds.map((granuleId) =>
    granuleModel.create(fakeGranuleFactoryV2({
      granuleId,
      collectionId: t.context.collectionId,
    }))));

  const granulePgModel = new GranulePgModel();
  const granulesExecutionsPgModel = new GranulesExecutionsPgModel();
  const executionPgModel = new ExecutionPgModel();
  const collectionPgModel = new CollectionPgModel();
  const [pgCollection] = await collectionPgModel.create(
    t.context.knex,
    collection
  );
  t.context.collectionCumulusId = pgCollection.cumulus_id;

  const translatedGranules = await Promise.all(t.context.granules.map(async (granule) =>
    await translateApiGranuleToPostgresGranule({
      dynamoRecord: granule,
      knexOrTransaction: t.context.knex,
    })));

  const pgGranules = await granulePgModel.create(
    t.context.knex,
    translatedGranules
  );
  const pgExecutions = await executionPgModel.create(
    t.context.knex,
    t.context.executionArns.map((executionArn) =>
      fakeExecutionRecordFactory({
        workflow_name: t.context.workflowName,
        arn: executionArn,
      }))
  );
  const joinRecords = [
    {
      execution_cumulus_id: pgExecutions[0].cumulus_id,
      granule_cumulus_id: pgGranules[0].cumulus_id,
    },
    {
      execution_cumulus_id: pgExecutions[1].cumulus_id,
      granule_cumulus_id: pgGranules[1].cumulus_id,
    },
  ];
  await granulesExecutionsPgModel.create(t.context.knex, joinRecords);
};

const verifyGranulesQueuedStatus = async (t) => {
  const granulePgModel = new GranulePgModel();
  const pgGranules = await Promise.all(
    t.context.granuleIds.map((granuleId) =>
      granulePgModel.get(t.context.knex, {
        granule_id: granuleId,
        collection_cumulus_id: t.context.collectionCumulusId,
      }))
  );
  pgGranules.forEach((granule) => {
    t.is(granule.status, 'queued');
  });

  const granuleModel = new Granule();
  const dynamoGranules = await Promise.all(
    t.context.granuleIds.map((granuleId) =>
      granuleModel.get({ granuleId }))
  );
  dynamoGranules.forEach((granule) => {
    t.is(granule.status, 'queued');
  });
};

test.before(async (t) => {
  process.env = {
    ...process.env,
    ...localStackConnectionEnv,
    PG_DATABASE: testDbName,
    METRICS_ES_HOST: randomId('host'),
    METRICS_ES_USER: randomId('user'),
    METRICS_ES_PASS: randomId('pass'),
    GranulesTable: randomId('granule'),
    ...envVars,
  };

  // create a fake bucket
  await createBucket(envVars.system_bucket);

  await new Granule().createTable();

  applyWorkflowStub = sandbox.stub();
  reingestStub = sandbox.stub();
  sandbox.stub(Granule.prototype, '_removeGranuleFromCmr').resolves();

  const { knex, knexAdmin } = await generateLocalTestDb(testDbName, migrationDir);
  t.context.knex = knex;
  t.context.knexAdmin = knexAdmin;

  const { esIndex, esClient } = await createTestIndex();
  t.context.esIndex = esIndex;
  t.context.esClient = esClient;

  // Store the CMR password
  process.env.cmr_password_secret_name = randomString();
  await awsServices.secretsManager().createSecret({
    Name: envVars.cmr_password_secret_name,
    SecretString: randomString(),
  }).promise();

  // Store the launchpad passphrase
  process.env.launchpad_passphrase_secret_name = randomString();
  await awsServices.secretsManager().createSecret({
    Name: envVars.launchpad_passphrase_secret_name,
    SecretString: randomString(),
  }).promise();
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
  sandbox.resetHistory();
});

test.after.always(async (t) => {
  await awsServices.secretsManager().deleteSecret({
    SecretId: envVars.cmr_password_secret_name,
    ForceDeleteWithoutRecovery: true,
  }).promise();
  await awsServices.secretsManager().deleteSecret({
    SecretId: envVars.launchpad_passphrase_secret_name,
    ForceDeleteWithoutRecovery: true,
  }).promise();

  await destroyLocalTestDb({
    knex: t.context.knex,
    knexAdmin: t.context.knexAdmin,
    testDbName,
  });
  await cleanupTestIndex(t.context);
  sandbox.restore();
});

test.serial('applyWorkflowToGranules passed on queueUrl to applyWorkflow', async (t) => {
  await setUpExistingDatabaseRecords(t);
  const workflowName = 'test-workflow';
  const queueUrl = `${cryptoRandomString({ length: 5 })}_queue`;

  const applyWorkflowSpy = sinon.spy();
  const updateGranulesToQueuedMethod = () => Promise.resolve();
  const fakeGranulePgModel = {
    search: () => [{}],
  };

  await bulkOperation.applyWorkflowToGranules({
    applyWorkflowHandler: applyWorkflowSpy,
    granuleIds: t.context.granuleIds,
    granulePgModel: fakeGranulePgModel,
    granuleTranslateMethod: (_granule) => ({}),
    knex: t.context.knex,
    queueUrl,
    updateGranulesToQueuedMethod,
    workflowName,
  });
  t.is(applyWorkflowSpy.getCall(0).args[0].queueUrl, queueUrl);
});

test('bulk operation lambda throws error for unknown event type', async (t) => {
  await t.throwsAsync(bulkOperation.handler({
    type: randomId('type'),
  }));
});

// This test must run for the following tests to pass
test.serial('bulk operation lambda sets env vars provided in payload', async (t) => {
  const granuleModel = new Granule();
  const granule = await granuleModel.create(fakeGranuleFactoryV2());
  const workflowName = randomId('workflow');

  // delete existing ENVs
  Object.keys(envVars).forEach((envVarKey) => {
    delete process.env[envVarKey];
  });

  await bulkOperation.handler({
    type: 'BULK_GRANULE',
    envVars,
    payload: {
      ids: [granule.granuleId],
      workflowName,
    },
  });
  Object.keys(envVars).forEach((envVarKey) => {
    t.is(process.env[envVarKey], envVars[envVarKey]);
  });
});

test.serial('bulk operation BULK_GRANULE applies workflow to list of granule IDs', async (t) => {
  t.context.collectionPgModel = new CollectionPgModel();
  const collection = fakeCollectionRecordFactory();
  const [collectionPgRecord] = await t.context.collectionPgModel.create(
    t.context.knex,
    collection
  );
  const collectionCumulusId = collectionPgRecord.cumulus_id;

  const granuleModel = new GranulePgModel();
  const granules = [
    fakeGranuleRecordFactory({
      collection_cumulus_id: collectionCumulusId,
      created_at: new Date(),
      updated_at: new Date(),
    }),
    fakeGranuleRecordFactory({
      collection_cumulus_id: collectionCumulusId,
      created_at: new Date(),
      updated_at: new Date(),
    }),
  ];
  const pgGranules = await Promise.all([
    granuleModel.create(
      t.context.knex,
      granules[0]
    ),
    granuleModel.create(
      t.context.knex,
      granules[1]
    ),
  ]);
  const cumulusGranuleIds = pgGranules.map(([granule]) => granule.cumulus_id);

  granules[0].cumulus_id = cumulusGranuleIds[0];
  granules[1].cumulus_id = cumulusGranuleIds[1];

  const dynamoGranuleModel = new Granule();
  t.context.granules = await Promise.all(granules.map((g) => g.granule_id).map((granuleId) =>
    dynamoGranuleModel.create(fakeGranuleFactoryV2({
      granuleId,
      collectionId: collection.name,
    }))));

  const workflowName = randomId('workflow');
  await bulkOperation.handler({
    type: 'BULK_GRANULE',
    envVars,
    payload: {
      ids: [
        granules[0].granule_id,
        granules[1].granule_id,
      ],
      workflowName,
    },
    applyWorkflowHandler: applyWorkflowStub,
  });

  t.is(applyWorkflowStub.callCount, 2);
  // Can't guarantee processing order so test against granule matching by ID
  await Promise.all(applyWorkflowStub.args.map(async (callArgs) => {
    const granulePgRecord = granules.find((granule) =>
      granule.granule_id === callArgs[0].granule.granuleId);

    const matchingGranule = await translatePostgresGranuleToApiGranule({
      granulePgRecord,
      knexOrTransaction: t.context.knex,
    });

    t.deepEqual(matchingGranule, callArgs[0].granule);
    t.is(callArgs[0].workflow, workflowName);
  }));
});

test.serial('bulk operation BULK_GRANULE applies workflow to granule IDs returned by query', async (t) => {
  t.context.collectionPgModel = new CollectionPgModel();
  const collection = fakeCollectionRecordFactory();
  const [collectionPgRecord] = await t.context.collectionPgModel.create(
    t.context.knex,
    collection
  );
  const collectionCumulusId = collectionPgRecord.cumulus_id;

  const granuleModel = new GranulePgModel();
  const granules = [
    fakeGranuleRecordFactory({
      collection_cumulus_id: collectionCumulusId,
      created_at: new Date(),
      updated_at: new Date(),
    }),
    fakeGranuleRecordFactory({
      collection_cumulus_id: collectionCumulusId,
      created_at: new Date(),
      updated_at: new Date(),
    }),
  ];
  const pgGranules = await Promise.all([
    granuleModel.create(
      t.context.knex,
      granules[0]
    ),
    granuleModel.create(
      t.context.knex,
      granules[1]
    ),
  ]);
  const cumulusGranuleIds = pgGranules.map(([granule]) => granule.cumulus_id);

  granules[0].cumulus_id = cumulusGranuleIds[0];
  granules[1].cumulus_id = cumulusGranuleIds[1];
  t.context.granuleIds = granules.map((g) => g.granule_id);
  t.context.collectionCumulusId = collectionCumulusId;
  const dynamoGranuleModel = new Granule();
  t.context.granules = await Promise.all(t.context.granuleIds.map((granuleId) =>
    dynamoGranuleModel.create(fakeGranuleFactoryV2({
      granuleId,
      collectionId: collection.name,
    }))));
  esSearchStub.resolves({
    body: {
      hits: {
        hits: [{
          _source: {
            granuleId: granules[0].granule_id,
          },
        }, {
          _source: {
            granuleId: granules[1].granule_id,
          },
        }],
        total: {
          value: 2,
        },
      },
    },
  });

  const workflowName = randomId('workflow');
  await bulkOperation.handler({
    type: 'BULK_GRANULE',
    envVars,
    payload: {
      query: 'fake-query',
      workflowName,
      index: randomId('index'),
    },
    applyWorkflowHandler: applyWorkflowStub,
  });

  t.true(esSearchStub.called);
  t.is(applyWorkflowStub.callCount, 2);

  // Can't guarantee processing order so test against granule matching by ID
  await Promise.all(applyWorkflowStub.args.map(async (callArgs) => {
    const granulePgRecord = granules.find((granule) =>
      granule.granule_id === callArgs[0].granule.granuleId);

    const matchingGranule = await translatePostgresGranuleToApiGranule({
      granulePgRecord,
      knexOrTransaction: t.context.knex,
    });
    t.deepEqual(matchingGranule, callArgs[0].granule);
    t.is(callArgs[0].workflow, workflowName);
  }));
  await verifyGranulesQueuedStatus(t);
});

test.serial('applyWorkflowToGranules sets the granules status to queued', async (t) => {
  await setUpExistingDatabaseRecords(t);
  const workflowName = 'test-workflow';

  await bulkOperation.applyWorkflowToGranules({
    granuleIds: t.context.granuleIds,
    workflowName,
    granuleModel: new Granule(),
    knex: t.context.knex,
    applyWorkflowHandler: applyWorkflowStub,
  });

  t.is(applyWorkflowStub.callCount, 2);

  await verifyGranulesQueuedStatus(t);
});

test.serial('bulk operation BULK_GRANULE_DELETE deletes listed granule IDs from Dynamo and Postgres', async (t) => {
  const granuleModel = new Granule();
  const granulePgModel = new GranulePgModel();

  const granules = await Promise.all([
    createGranuleAndFiles({
      dbClient: t.context.knex,
      granuleParams: { published: false },
      esClient: t.context.esClient,
    }),
    createGranuleAndFiles({
      dbClient: t.context.knex,
      granuleParams: { published: false },
      esClient: t.context.esClient,
    }),
  ]);

  const s3Buckets = granules[0].s3Buckets;
  const dynamoGranuleId1 = granules[0].newDynamoGranule.granuleId;
  const dynamoGranuleId2 = granules[1].newDynamoGranule.granuleId;

  const { deletedGranules } = await bulkOperation.handler({
    type: 'BULK_GRANULE_DELETE',
    envVars,
    payload: {
      ids: [
        dynamoGranuleId1,
        dynamoGranuleId2,
      ],
    },
  });

  t.deepEqual(
    deletedGranules.sort(),
    [
      dynamoGranuleId1,
      dynamoGranuleId2,
    ].sort()
  );

  // Granules should have been deleted from Dynamo

  t.false(await granuleModel.exists({ granuleId: dynamoGranuleId1 }));
  t.false(await granuleModel.exists({ granuleId: dynamoGranuleId2 }));

  // Granules should have been deleted from Postgres
  const pgCollectionCumulusId1 = granules[0].newPgGranule.collection_cumulus_id;
  const pgCollectionCumulusId2 = granules[1].newPgGranule.collection_cumulus_id;

  t.false(await granulePgModel.exists(
    t.context.knex,
    { granule_id: dynamoGranuleId1, collection_cumulus_id: pgCollectionCumulusId1 }
  ));
  t.false(await granulePgModel.exists(
    t.context.knex,
    { granule_id: dynamoGranuleId2, collection_cumulus_id: pgCollectionCumulusId2 }
  ));

  t.teardown(() => deleteS3Buckets([
    s3Buckets.protected.name,
    s3Buckets.public.name,
  ]));
});

test.serial('bulk operation BULK_GRANULE_DELETE processes all granules that do not error', async (t) => {
  const errorMessage = 'fail';
  let count = 0;

  const deleteStub = sinon.stub(Granule.prototype, 'delete')
    .callsFake(() => {
      count += 1;
      if (count > 3) {
        throw new Error(errorMessage);
      }
      return Promise.resolve();
    });
  t.teardown(() => {
    deleteStub.restore();
  });

  const granules = await Promise.all([
    createGranuleAndFiles({ dbClient: t.context.knex, esClient: t.context.esClient }),
    createGranuleAndFiles({ dbClient: t.context.knex, esClient: t.context.esClient }),
    createGranuleAndFiles({ dbClient: t.context.knex, esClient: t.context.esClient }),
    createGranuleAndFiles({ dbClient: t.context.knex, esClient: t.context.esClient }),
    createGranuleAndFiles({ dbClient: t.context.knex, esClient: t.context.esClient }),
    createGranuleAndFiles({ dbClient: t.context.knex, esClient: t.context.esClient }),
  ]);

  const aggregateError = await t.throwsAsync(bulkOperation.handler({
    type: 'BULK_GRANULE_DELETE',
    envVars,
    payload: {
      ids: [
        granules[0].newDynamoGranule.granuleId,
        granules[1].newDynamoGranule.granuleId,
        granules[2].newDynamoGranule.granuleId,
        granules[3].newDynamoGranule.granuleId,
        granules[4].newDynamoGranule.granuleId,
        granules[5].newDynamoGranule.granuleId,
      ],
    },
  }));

  // tried to delete 6 times, but failed 3 times
  t.is(deleteStub.callCount, 6);
  t.deepEqual(
    Array.from(aggregateError).map((error) => error.message),
    [
      errorMessage,
      errorMessage,
      errorMessage,
    ]
  );

  const s3Buckets = granules[0].s3Buckets;

  t.teardown(() => deleteS3Buckets([
    s3Buckets.protected.name,
    s3Buckets.public.name,
  ]));
});

test.serial('bulk operation BULK_GRANULE_DELETE deletes granule IDs returned by query', async (t) => {
  const granules = await Promise.all([
    createGranuleAndFiles({ dbClient: t.context.knex, esClient: t.context.esClient }),
    createGranuleAndFiles({ dbClient: t.context.knex, esClient: t.context.esClient }),
  ]);

  esSearchStub.resolves({
    body: {
      hits: {
        hits: [{
          _source: {
            granuleId: granules[0].newDynamoGranule.granuleId,
          },
        }, {
          _source: {
            granuleId: granules[1].newDynamoGranule.granuleId,
          },
        }],
        total: {
          value: 2,
        },
      },
    },
  });

  const { deletedGranules } = await bulkOperation.handler({
    type: 'BULK_GRANULE_DELETE',
    envVars,
    payload: {
      query: 'fake-query',
      index: randomId('index'),
    },
  });

  t.true(esSearchStub.called);
  t.deepEqual(
    deletedGranules.sort(),
    [
      granules[0].newDynamoGranule.granuleId,
      granules[1].newDynamoGranule.granuleId,
    ].sort()
  );

  const s3Buckets = granules[0].s3Buckets;
  t.teardown(() => deleteS3Buckets([
    s3Buckets.protected.name,
    s3Buckets.public.name,
  ]));
});

test.serial('bulk operation BULK_GRANULE_DELETE does not throw error for granules that were already removed', async (t) => {
  const { deletedGranules } = await bulkOperation.handler({
    type: 'BULK_GRANULE_DELETE',
    envVars,
    payload: {
      ids: [
        'deleted-granule-id',
      ],
    },
  });
  t.deepEqual(deletedGranules, []);
});

test.serial('bulk operation BULK_GRANULE_REINGEST reingests list of granule IDs', async (t) => {
  await setUpExistingDatabaseRecords(t);
  const { granules, knex } = t.context;
  const payload = {
    ids: [
      granules[0].granuleId,
      granules[1].granuleId,
    ],
  };

  await bulkOperation.handler({
    type: 'BULK_GRANULE_REINGEST',
    envVars,
    payload,
    reingestHandler: reingestStub,
  });

  t.is(reingestStub.callCount, 2);
  reingestStub.args.forEach(async (callArgs) => {
    const matchingGranule = granules.find((granule) =>
      granule.granuleId === callArgs[0].granule.granuleId);

    const pgGranule = await getUniqueGranuleByGranuleId(knex, matchingGranule.granuleId);
    const translatedGranule = await translatePostgresGranuleToApiGranule({
      granulePgRecord: pgGranule,
      knexOrTransaction: knex,
    });

    t.deepEqual(translatedGranule, callArgs[0].granule);
    t.is(callArgs[0].asyncOperationId, process.env.asyncOperationId);
  });
});

test.serial('bulk operation BULK_GRANULE_REINGEST reingests list of granule IDs with a workflowName', async (t) => { // FAILURE
  await setUpExistingDatabaseRecords(t);
  const {
    granules,
    workflowName,
  } = t.context;

  await bulkOperation.handler({
    type: 'BULK_GRANULE_REINGEST',
    envVars,
    payload: {
      ids: [
        granules[0].granuleId,
        granules[1].granuleId,
      ],
      workflowName,
    },
    reingestHandler: reingestStub,
  });

  t.is(reingestStub.callCount, 2);
  reingestStub.args.forEach((callArgs) => {
    // verify that the call was made with an execution from the database, and
    // then compare all other fields except the execution against the model
    // granules.
    const matchingGranule = granules.find((granule) =>
      granule.granuleId === callArgs[0].granule.granuleId);

    t.true(t.context.executionArns.includes(callArgs[0].granule.execution));
    delete matchingGranule.execution;
    delete callArgs[0].granule.execution;
    matchingGranule.files = [];
    const omitList = ['dataType', 'version'];

    t.deepEqual(omit(matchingGranule, omitList), callArgs[0].granule);
    t.is(callArgs[0].asyncOperationId, process.env.asyncOperationId);
  });
});

test.serial('bulk operation BULK_GRANULE_REINGEST reingests granule IDs returned by query', async (t) => {
  await setUpExistingDatabaseRecords(t);
  const { granules, knex } = t.context;

  esSearchStub.resolves({
    body: {
      hits: {
        hits: [{
          _source: {
            granuleId: granules[0].granuleId,
          },
        }, {
          _source: {
            granuleId: granules[1].granuleId,
          },
        }],
        total: {
          value: 2,
        },
      },
    },
  });

  await bulkOperation.handler({
    type: 'BULK_GRANULE_REINGEST',
    envVars,
    payload: {
      query: 'fake-query',
      index: randomId('index'),
    },
    reingestHandler: reingestStub,
  });

  t.true(esSearchStub.called);
  t.is(reingestStub.callCount, 2);

  reingestStub.args.forEach(async (callArgs) => {
    const matchingGranule = granules.find((granule) =>
      granule.granuleId === callArgs[0].granule.granuleId);

    const pgGranule = await getUniqueGranuleByGranuleId(knex, matchingGranule.granuleId);
    const translatedGranule = await translatePostgresGranuleToApiGranule({
      granulePgRecord: pgGranule,
      knexOrTransaction: knex,
    });
    t.deepEqual(translatedGranule, callArgs[0].granule);
    t.is(callArgs[0].asyncOperationId, process.env.asyncOperationId);
  });
});

test.serial('bulk operation BULK_GRANULE_REINGEST sets the granules status to queued', async (t) => {
  await setUpExistingDatabaseRecords(t);
  await bulkOperation.handler({
    type: 'BULK_GRANULE_REINGEST',
    envVars,
    payload: {
      ids: t.context.granuleIds,
    },
    reingestHandler: reingestStub,
  });

  t.is(reingestStub.callCount, 2);

  await verifyGranulesQueuedStatus(t);
});

test.serial('bulk operation BULK_GRANULE_REINGEST does not reingest granules if they do not exist in PostgreSQL', async (t) => {
  const result = await bulkOperation.handler({
    type: 'BULK_GRANULE_REINGEST',
    envVars,
    payload: {
      ids: [
        randomGranuleId(),
        randomGranuleId(),
      ],
    },
    reingestHandler: reingestStub,
  });

  t.deepEqual(
    Array.from(result).map(((error) => error.err instanceof RecordDoesNotExist)),
    [true, true]
  );

  t.is(reingestStub.callCount, 0);
});
