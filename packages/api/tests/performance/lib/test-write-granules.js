'use strict';

const test = require('ava');
const pSettle = require('p-settle');

const cryptoRandomString = require('crypto-random-string');
const cloneDeep = require('lodash/cloneDeep');

const {
  getEsClient,
  Search,
} = require('@cumulus/es-client/search');
const { createSnsTopic } = require('@cumulus/aws-client/SNS');
const StepFunctions = require('@cumulus/aws-client/StepFunctions');

const { constructCollectionId } = require('@cumulus/message/Collections');
const {
  fakeCollectionRecordFactory,
  fakeExecutionRecordFactory,
  fakeProviderRecordFactory,
  fakePdrRecordFactory,
  generateLocalTestDb,
  destroyLocalTestDb,
  CollectionPgModel,
  ProviderPgModel,
  ExecutionPgModel,
  GranulesExecutionsPgModel,
  GranulePgModel,
  FilePgModel,
  PdrPgModel,
  migrationDir,
  TableNames,
} = require('@cumulus/db');
const { sns, sqs } = require('@cumulus/aws-client/services');
const {
  SubscribeCommand,
  DeleteTopicCommand,
} = require('@aws-sdk/client-sns');
const {
  getExecutionUrlFromArn,
} = require('@cumulus/message/Executions');
const {
  createTestIndex,
  cleanupTestIndex,
} = require('@cumulus/es-client/testUtils');

const {
  writeGranulesFromMessage,
} = require('../../../lib/writeRecords/write-granules');
const { fakeFileFactory, fakeGranuleFactoryV2 } = require('../../../lib/testUtils');

test.before(async (t) => {
  // Test configuration values
  t.context.concurrency = 60;
  process.env.dbMaxPool = 60;
  t.context.totalGranules = 2000;
  t.context.granuleFiles = 10;

  t.context.testDbName = `writeGranules_${cryptoRandomString({ length: 10 })}`;
  t.context.stepFunctionUtils = {
    ...StepFunctions,
    describeExecution: () => Promise.resolve({}),
  };

  const { knexAdmin, knex } = await generateLocalTestDb(
    t.context.testDbName,
    migrationDir,
    { ...process.env }
  );
  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;

  console.log(`Test DB max connection pool: ${t.context.knex.client.pool.max}`);

  const { esIndex, esClient } = await createTestIndex();
  t.context.esIndex = esIndex;
  t.context.esClient = esClient;
  t.context.esGranulesClient = new Search(
    {},
    'granule',
    t.context.esIndex
  );
});

test.beforeEach(async (t) => {
  t.context.pdrPgModel = new PdrPgModel();
  t.context.collectionPgModel = new CollectionPgModel();
  t.context.executionPgModel = new ExecutionPgModel();
  t.context.granulePgModel = new GranulePgModel();
  t.context.filePgModel = new FilePgModel();
  t.context.granulesExecutionsPgModel = new GranulesExecutionsPgModel();
  t.context.providerPgModel = new ProviderPgModel();

  const topicName = cryptoRandomString({ length: 10 });
  const { TopicArn } = await createSnsTopic(topicName);
  process.env.granule_sns_topic_arn = TopicArn;
  t.context.TopicArn = TopicArn;

  const QueueName = cryptoRandomString({ length: 10 });
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

  t.context.stateMachineName = cryptoRandomString({ length: 5 });
  t.context.stateMachineArn = `arn:aws:states:us-east-1:12345:stateMachine:${t.context.stateMachineName}`;

  t.context.executionName = cryptoRandomString({ length: 5 });
  t.context.executionArn = `arn:aws:states:us-east-1:12345:execution:${t.context.stateMachineName}:${t.context.executionName}`;
  t.context.executionUrl = getExecutionUrlFromArn(t.context.executionArn);
  const execution = fakeExecutionRecordFactory({
    arn: t.context.executionArn,
    url: t.context.executionUrl,
    status: 'completed',
  });

  t.context.collection = fakeCollectionRecordFactory();
  t.context.collectionId = constructCollectionId(
    t.context.collection.name,
    t.context.collection.version
  );
  t.context.provider = fakeProviderRecordFactory();

  t.context.granuleId = cryptoRandomString({ length: 10 });
  t.context.files = [
    fakeFileFactory({ size: 5 }),
    fakeFileFactory({ size: 5 }),
    fakeFileFactory({ size: 5 }),
  ];

  const [pgCollection] = await t.context.collectionPgModel.create(
    t.context.knex,
    t.context.collection
  );
  t.context.collectionCumulusId = pgCollection.cumulus_id;

  const [pgExecution] = await t.context.executionPgModel.create(
    t.context.knex,
    execution
  );
  t.context.executionCumulusId = pgExecution.cumulus_id;
  t.context.executionUrl = pgExecution.url;

  const [pgProvider] = await t.context.providerPgModel.create(
    t.context.knex,
    t.context.provider
  );
  t.context.providerCumulusId = pgProvider.cumulus_id;

  // Generate and create a PDR for reference in postgres
  t.context.pdr = fakePdrRecordFactory({
    collection_cumulus_id: t.context.collectionCumulusId,
    provider_cumulus_id: t.context.providerCumulusId,
  });

  const [pgPdr] = await t.context.pdrPgModel.create(
    t.context.knex,
    t.context.pdr
  );
  t.context.providerPdrId = pgPdr.cumulus_id;

  t.context.granules = Array.from({ length: t.context.totalGranules }, () => fakeGranuleFactoryV2({
    files: new Array(t.context.granuleFiles).fill(0).map(() => fakeFileFactory({ bucket: 'cumulus-test-sandbox-internal', size: 0 })),
    provider: 'fake-provider',
  }));

  t.context.workflowStartTime = Date.now();
  t.context.cumulusMessage = {
    cumulus_meta: {
      workflow_start_time: t.context.workflowStartTime,
      state_machine: t.context.stateMachineArn,
      execution_name: t.context.executionName,
    },
    meta: {
      status: 'completed',
      collection: t.context.collection,
      provider: t.context.provider,
    },
    payload: {
      granules: null,
      pdr: t.context.pdr,
    },
  };

  function testChunk(arr, chunkSize, cumulusMessage) {
    const chunks = [];
    for (let i = 0; i < arr.length; i += chunkSize) {
      const messageCopy = cloneDeep(cumulusMessage);
      messageCopy.payload.granules = arr.slice(i, i + chunkSize);
      chunks.push(messageCopy);
    }
    return chunks;
  }
  t.context.cumulusMessages = testChunk(t.context.granules, 10, t.context.cumulusMessage);
});

test.afterEach.always(async (t) => {
  const { QueueUrl, TopicArn } = t.context;

  await sqs().deleteQueue({ QueueUrl });
  await sns().send(new DeleteTopicCommand({ TopicArn }));

  await t.context.knex(TableNames.files).del();
  await t.context.knex(TableNames.granulesExecutions).del();
  await t.context.knex(TableNames.granules).del();
});

test.after.always(async (t) => {
  await destroyLocalTestDb({
    ...t.context,
  });
  await cleanupTestIndex(t.context);
});

// This test is a performance test designed to run with a large number of messages
// in a memory constrained test environment, it is not intended to run as part of
// the normal unit test suite.
test('writeGranulesFromMessage operates on 2k granules with 10 files each within 1GB of ram when an instance of EsClient is passed in and concurrency is set to 60 and db connections are set to 60', async (t) => {
  const {
    cumulusMessages,
    knex,
    executionCumulusId,
    providerCumulusId,
    stepFunctionUtils,
  } = t.context;

  // Message must be completed or files will not update

  const esClient = await getEsClient();
  await pSettle(cumulusMessages.map((cumulusMessage) => () => writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    esClient,
    testOverrides: { stepFunctionUtils },
  })), { concurrency: t.context.concurrency });

  let notEmpty = true;
  const allMessages = [];

  while (notEmpty) {
    // eslint-disable-next-line no-await-in-loop
    const { Messages } = await sqs().receiveMessage({
      QueueUrl: t.context.QueueUrl,
      WaitTimeSeconds: 10,
      MaxNumberOfMessages: 10,
    });
    if (Messages === undefined) {
      notEmpty = false;
    } else {
      allMessages.push(...Messages);
    }
  }
  t.is(allMessages.length, t.context.totalGranules);
});
