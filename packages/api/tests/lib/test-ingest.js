const test = require('ava');
const sinon = require('sinon');

const { randomString } = require('@cumulus/common/test-utils');
const Lambda = require('@cumulus/aws-client/Lambda');
const {
  creatTopic,
  deleteTopic,
} = require('@cumulus/aws-client/SNS');
const { createBucket } = require('@cumulus/aws-client/S3');
const StepFunctions = require('@cumulus/aws-client/StepFunctions');
const { constructCollectionId } = require('@cumulus/message/Collections');
const {
  localStackConnectionEnv,
  generateLocalTestDb,
  destroyLocalTestDb,
  GranulePgModel,
  migrationDir,
  translateApiGranuleToPostgresGranule,
  CollectionPgModel,
  fakeCollectionRecordFactory,
  getUniqueGranuleByGranuleId,
} = require('@cumulus/db');
const {
  createTestIndex,
} = require('@cumulus/es-client/testUtils');
const {
  fakeGranuleFactoryV2,
  fakeCollectionFactory,
} = require('../../lib/testUtils');
const rulesHelpers = require('../../lib/rulesHelpers');
const {
  reingestGranule,
  applyWorkflow,
} = require('../../lib/ingest');

const testDbName = randomString(12);
const sandbox = sinon.createSandbox();
const FakeEsClient = sandbox.stub();
const esSearchStub = sandbox.stub();
const esScrollStub = sandbox.stub();
FakeEsClient.prototype.scroll = esScrollStub;
FakeEsClient.prototype.search = esSearchStub;

let fakeExecution;
let testCumulusMessage;
[
  'system_bucket',
  'stackName',
  // eslint-disable-next-line no-return-assign
].forEach((varName) => process.env[varName] = randomString());

test.before(async (t) => {
  process.env = {
    ...process.env,
    ...localStackConnectionEnv,
    PG_DATABASE: testDbName,
  };
  await createBucket(process.env.system_bucket);

  const { knex, knexAdmin } = await generateLocalTestDb(testDbName, migrationDir);
  t.context.knex = knex;
  t.context.knexAdmin = knexAdmin;
  t.context.granuleId = randomString();

  const { esIndex, esClient } = await createTestIndex();
  t.context.esIndex = esIndex;
  t.context.esClient = esClient;

  const { TopicArn } = await createTopic({ Name: randomString() });
  t.context.granules_sns_topic_arn = TopicArn;
  process.env.granule_sns_topic_arn = t.context.granules_sns_topic_arn;

  testCumulusMessage = {
    cumulus_meta: {
      execution_name: randomString(),
      state_machine: 'arn:aws:states:us-east-1:123456789012:stateMachine:HelloStateMachine',
      workflow_start_time: Date.now(),
    },
    meta: {
      collection: {
        name: randomString(),
        version: randomString(),
      },
      provider: {
        host: randomString(),
        protocol: 's3',
      },
      status: 'completed',
    },
    payload: {
      granules: [
        {
          granuleId: t.context.granuleId,
          sync_granule_duration: 123,
          post_to_cmr_duration: 456,
          files: [],
        },
      ],
    },
  };

  fakeExecution = {
    input: JSON.stringify(testCumulusMessage),
    startDate: new Date(Date.UTC(2019, 6, 28)),
    stopDate: new Date(Date.UTC(2019, 6, 28, 1)),
  };
  sandbox.stub(StepFunctions, 'describeExecution').resolves(fakeExecution);

  // Create collections in Dynamo and Postgres
  // we need this because a granule has a foreign key referring to collections
  const collectionName = 'fakeCollection';
  const collectionVersion = 'v1';

  t.context.testCollection = fakeCollectionFactory({
    name: collectionName,
    version: collectionVersion,
    duplicateHandling: 'error',
  });
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
  t.context.collectionCumulusId = pgCollection.cumulus_id;
});

test.afterEach.always(() => {
  sandbox.resetHistory();
});

test.after.always(async (t) => {
  sandbox.restore();
  await destroyLocalTestDb({
    knex: t.context.knex,
    knexAdmin: t.context.knexAdmin,
    testDbName,
  });
  await deleteTopic({ TopicArn: t.context.granules_sns_topic_arn });
});

test.serial('reingestGranule pushes a message with the correct queueUrl', async (t) => {
  const {
    collectionId,
  } = t.context;
  const granulePgModel = new GranulePgModel();
  const queueUrl = 'testqueueUrl';

  const apiGranule = fakeGranuleFactoryV2({
    collectionId,
  });

  const buildPayloadSpy = sinon.stub(rulesHelpers, 'buildPayload').resolves();

  await granulePgModel.create(
    t.context.knex,
    await translateApiGranuleToPostgresGranule({
      dynamoRecord: apiGranule,
      knexOrTransaction: t.context.knex,
    })
  );

  t.teardown(() => buildPayloadSpy.restore());

  await reingestGranule({
    apiGranule,
    queueUrl,
    granulePgModel,
  });
  // Rule.buildPayload has its own unit tests to ensure the queue name
  // is used properly, so just ensure that we pass the correct argument
  // to that function.
  t.is(buildPayloadSpy.args[0][0].queueUrl, queueUrl);

  const updatedPgGranule = await getUniqueGranuleByGranuleId(
    t.context.knex,
    apiGranule.granuleId
  );
  t.is(updatedPgGranule.status, 'queued');
});

test.serial('applyWorkflow throws error if workflow argument is missing', async (t) => {
  const apiGranule = {
    granuleId: randomString(),
  };

  await t.throwsAsync(
    applyWorkflow(apiGranule),
    {
      instanceOf: TypeError,
    }
  );
});

test.serial('applyWorkflow invokes Lambda to schedule workflow', async (t) => {
  const apiGranule = fakeGranuleFactoryV2({
    collectionId: t.context.collectionId,
  });
  const workflow = randomString();
  const lambdaPayload = {
    payload: {
      granules: [apiGranule],
    },
  };

  const buildPayloadStub = sinon.stub(rulesHelpers, 'buildPayload').resolves(lambdaPayload);
  const lambdaInvokeStub = sinon.stub(Lambda, 'invoke').resolves();

  await applyWorkflow({ apiGranule, workflow });

  try {
    t.true(lambdaInvokeStub.called);
    t.deepEqual(lambdaInvokeStub.args[0][1], lambdaPayload);
  } finally {
    buildPayloadStub.restore();
    lambdaInvokeStub.restore();
  }
});

test.serial('applyWorkflow uses custom queueUrl, if provided', async (t) => {
  const granulePgModel = new GranulePgModel();

  const apiGranule = fakeGranuleFactoryV2({
    collectionId: t.context.collectionId,
  });
  const workflow = randomString();
  const queueUrl = randomString();

  await granulePgModel.create(
    t.context.knex,
    await translateApiGranuleToPostgresGranule({
      dynamoRecord: apiGranule,
      knexOrTransaction: t.context.knex,
    })
  );

  const buildPayloadStub = sinon.stub(rulesHelpers, 'buildPayload').resolves();
  const lambdaInvokeStub = sinon.stub(Lambda, 'invoke').resolves();

  try {
    await applyWorkflow({ apiGranule, workflow, queueUrl });

    t.true(buildPayloadStub.called);
    t.like(buildPayloadStub.args[0][0], {
      queueUrl,
    });
  } finally {
    buildPayloadStub.restore();
    lambdaInvokeStub.restore();
  }
});
