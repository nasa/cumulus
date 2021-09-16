const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const proxyquire = require('proxyquire');
const sinon = require('sinon');

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
  localStackConnectionEnv,
  migrationDir,
  destroyLocalTestDb,
  translatePostgresGranuleToApiGranule,
} = require('@cumulus/db');
const { randomId, randomString } = require('@cumulus/common/test-utils');
const { createBucket, deleteS3Buckets } = require('@cumulus/aws-client/S3');
const {
  createTestIndex,
  cleanupTestIndex,
} = require('@cumulus/es-client/testUtils');
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

  const granulePgModel = new GranulePgModel();
  const granulesExecutionsPgModel = new GranulesExecutionsPgModel();
  const executionPgModel = new ExecutionPgModel();
  const collectionPgModel = new CollectionPgModel();
  const [pgCollection] = await collectionPgModel.create(
    t.context.knex,
    fakeCollectionRecordFactory()
  );
  t.context.collectionCumulusId = pgCollection.cumulus_id;
  const collectionCumulusId = t.context.collectionCumulusId;

  const granuleCumulusIds = await granulePgModel.create(
    t.context.knex,
    [
      fakeGranuleRecordFactory({
        collection_cumulus_id: collectionCumulusId,
        granule_id: t.context.granuleIds[0],
      }),
      fakeGranuleRecordFactory({
        collection_cumulus_id: collectionCumulusId,
        granule_id: t.context.granuleIds[1],
      }),
    ]
  );
  const pgExecutions = await executionPgModel.create(
    t.context.knex,
    [
      fakeExecutionRecordFactory({
        workflow_name: t.context.workflowName,
        arn: t.context.executionArns[0],
      }),
      fakeExecutionRecordFactory({
        workflow_name: t.context.workflowName,
        arn: t.context.executionArns[1],
      }),
    ]
  );
  const joinRecords = [
    {
      execution_cumulus_id: pgExecutions[0].cumulus_id,
      granule_cumulus_id: granuleCumulusIds[0],
    },
    {
      execution_cumulus_id: pgExecutions[1].cumulus_id,
      granule_cumulus_id: granuleCumulusIds[1],
    },
  ];
  await granulesExecutionsPgModel.create(t.context.knex, joinRecords);
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

test.afterEach.always(() => {
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

test('applyWorkflowToGranules passed on queueUrl to applyWorkflow', async (t) => {
  const granuleIds = ['granule-1'];
  const workflowName = 'test-workflow';
  const queueUrl = `${cryptoRandomString({ length: 5 })}_queue`;

  const applyWorkflowSpy = sinon.spy();
  const fakeGranulePgModel = {
    search: () => [{}],
  };

  await bulkOperation.applyWorkflowToGranules({
    granuleIds,
    workflowName,
    queueUrl,
    granulePgModel: fakeGranulePgModel,
    granuleTranslateMethod: (_granule) => ({}),
    applyWorkflowHandler: applyWorkflowSpy,
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
  const cumulusGranuleIds = await Promise.all([
    granuleModel.create(
      t.context.knex,
      granules[0]
    ),
    granuleModel.create(
      t.context.knex,
      granules[1]
    ),
  ]);

  granules[0].cumulus_id = cumulusGranuleIds[0][0];
  granules[1].cumulus_id = cumulusGranuleIds[1][0];

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
  const cumulusGranuleIds = await Promise.all([
    granuleModel.create(
      t.context.knex,
      granules[0]
    ),
    granuleModel.create(
      t.context.knex,
      granules[1]
    ),
  ]);

  granules[0].cumulus_id = cumulusGranuleIds[0][0];
  granules[1].cumulus_id = cumulusGranuleIds[1][0];

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
  const granuleModel = new Granule();
  const granules = await Promise.all([
    granuleModel.create(fakeGranuleFactoryV2()),
    granuleModel.create(fakeGranuleFactoryV2()),
  ]);

  await bulkOperation.handler({
    type: 'BULK_GRANULE_REINGEST',
    envVars,
    payload: {
      ids: [
        granules[0].granuleId,
        granules[1].granuleId,
      ],
    },
    reingestHandler: reingestStub,
  });

  t.is(reingestStub.callCount, 2);
  reingestStub.args.forEach((callArgs) => {
    const matchingGranule = granules.find((granule) =>
      granule.granuleId === callArgs[0].granuleForIngest.granuleId);

    t.deepEqual(matchingGranule, callArgs[0].granuleForIngest);
    t.is(callArgs[0].asyncOperationId, process.env.asyncOperationId);
  });
});

test.serial('bulk operation BULK_GRANULE_REINGEST reingests list of granule IDs with a workflowName', async (t) => {
  await setUpExistingDatabaseRecords(t);
  const workflowName = t.context.workflowName;
  const granuleModel = new Granule();
  const granules = await Promise.all([
    granuleModel.create(fakeGranuleFactoryV2({ granuleId: t.context.granuleIds[0] })),
    granuleModel.create(fakeGranuleFactoryV2({ granuleId: t.context.granuleIds[1] })),
  ]);

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
      granule.granuleId === callArgs[0].granuleForIngest.granuleId);

    t.true(t.context.executionArns.includes(callArgs[0].granuleForIngest.execution));

    delete matchingGranule.execution;
    delete callArgs[0].granuleForIngest.execution;

    t.deepEqual(matchingGranule, callArgs[0].granuleForIngest);
    t.is(callArgs[0].asyncOperationId, process.env.asyncOperationId);
  });
});

test.serial('bulk operation BULK_GRANULE_REINGEST reingests granule IDs returned by query', async (t) => {
  const granuleModel = new Granule();
  const granules = await Promise.all([
    granuleModel.create(fakeGranuleFactoryV2()),
    granuleModel.create(fakeGranuleFactoryV2()),
  ]);

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

  reingestStub.args.forEach((callArgs) => {
    const matchingGranule = granules.find((granule) =>
      granule.granuleId === callArgs[0].granuleForIngest.granuleId);

    t.deepEqual(matchingGranule, callArgs[0].granuleForIngest);
    t.is(callArgs[0].asyncOperationId, process.env.asyncOperationId);
  });
});
