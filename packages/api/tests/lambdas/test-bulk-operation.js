const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const proxyquire = require('proxyquire');
const sinon = require('sinon');
const omit = require('lodash/omit');

const {
  sqs,
} = require('@cumulus/aws-client/services');
const { sendSNSMessage } = require('@cumulus/aws-client/SNS');

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

  const collection = fakeCollectionRecordFactory();
  t.context.collectionId = constructCollectionId(collection.name, collection.version);

  t.context.granuleUniqueKeys = [
    { granuleId: randomGranuleId(), collectionId: t.context.collectionId },
    { granuleId: randomGranuleId(), collectionId: t.context.collectionId },
  ];

  const granulePgModel = new GranulePgModel();
  const granulesExecutionsPgModel = new GranulesExecutionsPgModel();
  const executionPgModel = new ExecutionPgModel();
  const collectionPgModel = new CollectionPgModel();
  const [pgCollection] = await collectionPgModel.create(
    t.context.knex,
    collection
  );
  t.context.collectionCumulusId = pgCollection.cumulus_id;

  const generatedPgGranules = t.context.granuleUniqueKeys.map((
    granule
  ) => fakeGranuleRecordFactory({
    granule_id: granule.granuleId,
    collection_cumulus_id: t.context.collectionCumulusId,
  }));

  const pgGranules = await granulePgModel.create(
    t.context.knex,
    generatedPgGranules
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
  t.context.granules = await Promise.all(
    pgGranules.map((granule) =>
      translatePostgresGranuleToApiGranule({
        granulePgRecord: granule,
        knexOrTransaction: t.context.knex,
      }))
  );

  t.context.granuleIds = t.context.granules.map((granule) => granule.granuleId);
  console.log('done');
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
};

test.before(async (t) => {
  process.env = {
    ...process.env,
    ...localStackConnectionEnv,
    PG_DATABASE: testDbName,
    METRICS_ES_HOST: randomId('host'),
    METRICS_ES_USER: randomId('user'),
    METRICS_ES_PASS: randomId('pass'),
    ...envVars,
  };

  // create a fake bucket
  await createBucket(envVars.system_bucket);

  applyWorkflowStub = sandbox.stub();
  reingestStub = sandbox.stub();

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
  const { TopicArn } = await sendSNSMessage({ Name: topicName }, 'CreateTopicCommand');
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
  const { SubscriptionArn } = await sendSNSMessage({
    TopicArn: TopicArn,
    Protocol: 'sqs',
    Endpoint: QueueArn,
    ReturnSubscriptionArn: true,
  }, 'SubscribeCommand');
  await sendSNSMessage({
    TopicArn: TopicArn,
    Token: SubscriptionArn,
  }, 'ConfirmSubscriptionCommand');
});

test.afterEach(async (t) => {
  const { QueueUrl, TopicArn } = t.context;
  await sqs().deleteQueue({ QueueUrl }).promise();
  await sendSNSMessage({ TopicArn: TopicArn }, 'DeleteTopicCommand');
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
  sandbox.resetHistory();
  sandbox.restore();
});

test.serial('applyWorkflowToGranules passed on queueUrl to applyWorkflow', async (t) => {
  await setUpExistingDatabaseRecords(t);
  const workflowName = 'test-workflow';
  const queueUrl = `${cryptoRandomString({ length: 5 })}_queue`;

  const applyWorkflowSpy = sinon.spy();
  const updateGranulesToQueuedMethod = () => Promise.resolve();
  const fakeGranulePgModel = {
    get: () => [{}],
  };

  await bulkOperation.applyWorkflowToGranules({
    applyWorkflowHandler: applyWorkflowSpy,
    granules: t.context.granuleUniqueKeys,
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
  const granule = fakeGranuleFactoryV2();
  const workflowName = randomId('workflow');

  // delete existing ENVs
  Object.keys(envVars).forEach((envVarKey) => {
    delete process.env[envVarKey];
  });

  await bulkOperation.handler({
    type: 'BULK_GRANULE',
    envVars,
    payload: {
      granules: [granule],
      workflowName,
    },
  });
  Object.keys(envVars).forEach((envVarKey) => {
    t.is(process.env[envVarKey], envVars[envVarKey]);
  });
});

test.serial('bulk operation BULK_GRANULE applies workflow to list of granules', async (t) => {
  await setUpExistingDatabaseRecords(t);

  const workflowName = randomId('workflow');
  await bulkOperation.handler({
    type: 'BULK_GRANULE',
    envVars,
    payload: {
      granules: t.context.granules,
      workflowName,
    },
    applyWorkflowHandler: applyWorkflowStub,
  });

  t.is(applyWorkflowStub.callCount, 2);
  // Can't guarantee processing order so test against granule matching by ID
  applyWorkflowStub.args.forEach((callArgs) => {
    const matchingGranule = t.context.granules.find((granule) =>
      granule.granuleId === callArgs[0].apiGranule.granuleId);

    t.deepEqual(matchingGranule, callArgs[0].apiGranule);
    t.is(callArgs[0].workflow, workflowName);
  });
});

test.serial('bulk operation BULK_GRANULE applies workflow to granules returned by query', async (t) => {
  await setUpExistingDatabaseRecords(t);

  esSearchStub.resolves({
    body: {
      hits: {
        hits: [{
          _source: {
            granuleId: t.context.granules[0].granuleId,
            collectionId: t.context.collectionId,
          },
        }, {
          _source: {
            granuleId: t.context.granules[1].granuleId,
            collectionId: t.context.collectionId,
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
  applyWorkflowStub.args.forEach((callArgs) => {
    const matchingGranule = t.context.granules.find((granule) =>
      granule.granuleId === callArgs[0].apiGranule.granuleId);

    t.deepEqual(matchingGranule, callArgs[0].apiGranule);
    t.is(callArgs[0].workflow, workflowName);
  });
  await verifyGranulesQueuedStatus(t);
});
test.serial('applyWorkflowToGranules sets the granules status to queued', async (t) => {
  await setUpExistingDatabaseRecords(t);
  const workflowName = 'test-workflow';

  await bulkOperation.applyWorkflowToGranules({
    granules: t.context.granules,
    workflowName,
    knex: t.context.knex,
    applyWorkflowHandler: applyWorkflowStub,
  });

  t.is(applyWorkflowStub.callCount, 2);

  await verifyGranulesQueuedStatus(t);
});

test.serial('bulk operation BULK_GRANULE_DELETE deletes listed granules from Postgres', async (t) => {
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
  const apiGranuleId1 = granules[0].newPgGranule.granule_id;
  const apiGranuleId2 = granules[1].newPgGranule.granule_id;

  const apiGranules = await Promise.all(
    granules.map((granule) => translatePostgresGranuleToApiGranule({
      granulePgRecord: granule.newPgGranule,
      knexOrTransaction: t.context.knex,
    }))
  );

  const { deletedGranules } = await bulkOperation.handler({
    type: 'BULK_GRANULE_DELETE',
    envVars,
    payload: {
      granules: apiGranules,
    },
  });

  t.deepEqual(
    deletedGranules.sort(),
    [
      apiGranuleId1,
      apiGranuleId2,
    ].sort()
  );

  // Granules should have been deleted from Postgres
  const pgCollectionCumulusId1 = granules[0].newPgGranule.collection_cumulus_id;
  const pgCollectionCumulusId2 = granules[1].newPgGranule.collection_cumulus_id;

  t.false(await granulePgModel.exists(
    t.context.knex,
    { granule_id: apiGranuleId1, collection_cumulus_id: pgCollectionCumulusId1 }
  ));
  t.false(await granulePgModel.exists(
    t.context.knex,
    { granule_id: apiGranuleId2, collection_cumulus_id: pgCollectionCumulusId2 }
  ));

  t.teardown(() => deleteS3Buckets([
    s3Buckets.protected.name,
    s3Buckets.public.name,
  ]));
});

test.serial('bulk operation BULK_GRANULE_DELETE processes all granules that do not error', async (t) => {
  const errorMessage = 'fail';
  let count = 0;

  const deleteStub = sinon.stub(GranulePgModel.prototype, 'delete')
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

  const apiGranules = await Promise.all(
    granules.map((granule) => translatePostgresGranuleToApiGranule({
      granulePgRecord: granule.newPgGranule,
      knexOrTransaction: t.context.knex,
    }))
  );

  const aggregateError = await t.throwsAsync(bulkOperation.handler({
    type: 'BULK_GRANULE_DELETE',
    envVars,
    payload: {
      granules: apiGranules,
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

test.serial('bulk operation BULK_GRANULE_DELETE deletes granules returned by query', async (t) => {
  await setUpExistingDatabaseRecords(t);

  esSearchStub.resolves({
    body: {
      hits: {
        hits: [{
          _source: {
            granuleId: t.context.granules[0].granuleId,
            collectionId: t.context.collectionId,
          },
        }, {
          _source: {
            granuleId: t.context.granules[1].granuleId,
            collectionId: t.context.collectionId,
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
      t.context.granules[0].granuleId,
      t.context.granules[1].granuleId,
    ].sort()
  );
});

test.serial('bulk operation BULK_GRANULE_DELETE does not throw error for granules that were already removed', async (t) => {
  const collectionPgModel = new CollectionPgModel();
  const collection = fakeCollectionRecordFactory();
  const [collectionPgRecord] = await collectionPgModel.create(
    t.context.knex,
    collection
  );

  const { deletedGranules } = await bulkOperation.handler({
    type: 'BULK_GRANULE_DELETE',
    envVars,
    payload: {
      granules: [{
        granuleId: 'deleted-granule-id',
        collectionId: constructCollectionId(collectionPgRecord.name, collectionPgRecord.version),
      }],
    },
  });
  t.deepEqual(deletedGranules, []);
});

test.serial('bulk operation BULK_GRANULE_DELETE throws an error if the collection cannot be found', async (t) => {
  await t.throwsAsync(bulkOperation.handler({
    type: 'BULK_GRANULE_DELETE',
    envVars,
    payload: {
      granules: [{
        granuleId: 'deleted-granule-id',
        collectionId: 'fake-collection-id',
      }],
    },
  }));
});

test.serial('bulk operation BULK_GRANULE_REINGEST reingests list of granules', async (t) => {
  await setUpExistingDatabaseRecords(t);
  const { granules, knex } = t.context;

  const payload = {
    granules,
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
      granule.granuleId === callArgs[0].apiGranule.granuleId);

    const pgGranule = await getUniqueGranuleByGranuleId(knex, matchingGranule.granuleId);
    const translatedGranule = await translatePostgresGranuleToApiGranule({
      granulePgRecord: pgGranule,
      knexOrTransaction: knex,
    });

    t.deepEqual(translatedGranule, callArgs[0].granule);
    t.is(callArgs[0].asyncOperationId, process.env.asyncOperationId);
  });
});

test.serial('bulk operation BULK_GRANULE_REINGEST reingests list of granules with a workflowName', async (t) => {
  await setUpExistingDatabaseRecords(t);
  const {
    granules,
    workflowName,
  } = t.context;

  await bulkOperation.handler({
    type: 'BULK_GRANULE_REINGEST',
    envVars,
    payload: {
      granules,
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
      granule.granuleId === callArgs[0].apiGranule.granuleId);

    t.true(t.context.executionArns.includes(callArgs[0].apiGranule.execution));
    delete matchingGranule.execution;
    delete callArgs[0].apiGranule.execution;
    matchingGranule.files = [];
    const omitList = ['dataType', 'version'];

    t.deepEqual(omit(matchingGranule, omitList), callArgs[0].apiGranule);
    t.is(callArgs[0].asyncOperationId, process.env.asyncOperationId);
  });
});

test.serial('bulk operation BULK_GRANULE_REINGEST reingests granules returned by query', async (t) => {
  await setUpExistingDatabaseRecords(t);

  esSearchStub.resolves({
    body: {
      hits: {
        hits: [{
          _source: {
            granuleId: t.context.granules[0].granuleId,
            collectionId: t.context.collectionId,
          },
        }, {
          _source: {
            granuleId: t.context.granules[1].granuleId,
            collectionId: t.context.collectionId,
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
    const matchingGranule = t.context.granules.find((granule) =>
      granule.granuleId === callArgs[0].apiGranule.granuleId);

    const pgGranule = await getUniqueGranuleByGranuleId(t.context.knex, matchingGranule.granuleId);
    const translatedGranule = await translatePostgresGranuleToApiGranule({
      granulePgRecord: pgGranule,
      knexOrTransaction: t.context.knex,
    });
    t.deepEqual(translatedGranule, callArgs[0].apiGranule);
    t.is(callArgs[0].asyncOperationId, process.env.asyncOperationId);
  });
});

test.serial('bulk operation BULK_GRANULE_REINGEST sets the granules status to queued', async (t) => {
  await setUpExistingDatabaseRecords(t);

  await bulkOperation.handler({
    type: 'BULK_GRANULE_REINGEST',
    envVars,
    payload: {
      granules: t.context.granules,
    },
    reingestHandler: reingestStub,
  });

  t.is(reingestStub.callCount, 2);

  await verifyGranulesQueuedStatus(t);
});

test.serial('bulk operation BULK_GRANULE_REINGEST does not reingest granules if they do not exist in PostgreSQL', async (t) => {
  const collectionPgModel = new CollectionPgModel();

  const collection = fakeCollectionRecordFactory();
  const [collectionPgRecord] = await collectionPgModel.create(
    t.context.knex,
    collection
  );

  const result = await bulkOperation.handler({
    type: 'BULK_GRANULE_REINGEST',
    envVars,
    payload: {
      granules: [
        {
          granuleId: randomGranuleId(),
          collectionId: constructCollectionId(
            collectionPgRecord.name,
            collectionPgRecord.version
          ),
        },
        {
          granuleId: randomGranuleId(),
          collectionId: constructCollectionId(
            collectionPgRecord.name,
            collectionPgRecord.version
          ),
        },
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
