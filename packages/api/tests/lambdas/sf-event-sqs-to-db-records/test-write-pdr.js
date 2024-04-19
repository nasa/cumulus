'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const sinon = require('sinon');

const {
  generateLocalTestDb,
  destroyLocalTestDb,
  fakeCollectionRecordFactory,
  fakeExecutionRecordFactory,
  fakeProviderRecordFactory,
  CollectionPgModel,
  ExecutionPgModel,
  PdrPgModel,
  ProviderPgModel,
  translatePostgresPdrToApiPdr,
  migrationDir,
} = require('@cumulus/db');
const { Search } = require('@cumulus/es-client/search');
const { sns, sqs } = require('@cumulus/aws-client/services');
const {
  CreateTopicCommand,
  SubscribeCommand,
  DeleteTopicCommand,
} = require('@aws-sdk/client-sns');
const { ReceiveMessageCommand } = require('@aws-sdk/client-sqs');
const {
  createTestIndex,
  cleanupTestIndex,
} = require('@cumulus/es-client/testUtils');

const {
  generatePdrRecord,
  writePdr,
  writePdrViaTransaction,
} = require('../../../lambdas/sf-event-sqs-to-db-records/write-pdr');

test.before(async (t) => {
  t.context.testDbName = `writePdr_${cryptoRandomString({ length: 10 })}`;

  const { knexAdmin, knex } = await generateLocalTestDb(
    t.context.testDbName,
    migrationDir
  );
  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;

  const { esIndex, esClient } = await createTestIndex();
  t.context.esIndex = esIndex;
  t.context.esClient = esClient;
  t.context.esPdrClient = new Search(
    {},
    'pdr',
    t.context.esIndex
  );
});

test.beforeEach(async (t) => {
  t.context.pdrName = cryptoRandomString({ length: 10 });
  t.context.pdr = {
    name: t.context.pdrName,
    PANSent: false,
    PANmessage: 'test',
  };

  t.context.workflowStartTime = Date.now();

  const collection = fakeCollectionRecordFactory();
  const collectionPgModel = new CollectionPgModel();
  const [pgCollection] = await collectionPgModel.create(
    t.context.knex,
    collection
  );
  t.context.collectionCumulusId = pgCollection.cumulus_id;

  const provider = fakeProviderRecordFactory();
  const providerPgModel = new ProviderPgModel();
  const [pgProvider] = await providerPgModel.create(t.context.knex, provider);
  t.context.providerCumulusId = pgProvider.cumulus_id;

  const execution = fakeExecutionRecordFactory();
  const executionPgModel = new ExecutionPgModel();
  const [pgExecution] = await executionPgModel.create(
    t.context.knex,
    execution
  );
  t.context.executionCumulusId = pgExecution.cumulus_id;

  t.context.runningPdrRecord = {
    name: t.context.pdr.name,
    status: 'running',
    execution_cumulus_id: t.context.executionCumulusId,
    collection_cumulus_id: t.context.collectionCumulusId,
    provider_cumulus_id: t.context.providerCumulusId,
    progress: 25,
    pan_sent: true,
    pan_message: 'message',
    stats: {
      running: ['arn'],
      completed: ['arn1', 'arn2', 'arn3'],
      failed: [],
    },
    duration: 1,
    timestamp: new Date(),
    created_at: new Date(),
  };

  t.context.cumulusMessage = {
    cumulus_meta: {
      state_machine: 'machine1',
      execution_name: 'execution1',
      workflow_start_time: t.context.workflowStartTime,
    },
    meta: {
      status: 'running',
      collection,
      provider: {
        id: provider.name,
        host: provider.host,
        protocol: provider.protocol,
      },
    },
    payload: {
      pdr: t.context.pdr,
      running: t.context.runningPdrRecord.stats.running,
      completed: t.context.runningPdrRecord.stats.completed,
      failed: t.context.runningPdrRecord.stats.failed,
    },
  };

  t.context.pdrPgModel = new PdrPgModel();
});

test.beforeEach(async (t) => {
  const topicName = cryptoRandomString({ length: 10 });
  const { TopicArn } = await sns().send(new CreateTopicCommand({ Name: topicName }));
  process.env.pdr_sns_topic_arn = TopicArn;
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
});

test.afterEach(async (t) => {
  const { QueueUrl, TopicArn } = t.context;
  await sqs().deleteQueue({ QueueUrl });
  await sns().send(new DeleteTopicCommand({ TopicArn }));
});

test.after.always(async (t) => {
  await destroyLocalTestDb({
    ...t.context,
  });
  await cleanupTestIndex(t.context);
});

test('generatePdrRecord() generates correct PDR record', (t) => {
  const {
    cumulusMessage,
    pdr,
    workflowStartTime,
  } = t.context;
  const now = workflowStartTime + 3500;
  const updatedAt = Date.now();

  cumulusMessage.payload = {
    ...cumulusMessage.payload,
    running: ['arn3', 'arn4'],
    completed: ['arn1', 'arn2'],
    failed: [],
  };

  t.deepEqual(
    generatePdrRecord({
      cumulusMessage,
      collectionCumulusId: 1,
      providerCumulusId: 2,
      executionCumulusId: 3,
      now,
      updatedAt,
    }),
    {
      name: pdr.name,
      status: 'running',
      pan_sent: pdr.PANSent,
      pan_message: pdr.PANmessage,
      stats: {
        processing: 2,
        completed: 2,
        failed: 0,
        total: 4,
      },
      progress: 50,
      execution_cumulus_id: 3,
      collection_cumulus_id: 1,
      provider_cumulus_id: 2,
      created_at: new Date(workflowStartTime),
      updated_at: new Date(updatedAt),
      timestamp: new Date(now),
      duration: 3.5,
    }
  );
});

test('writePdrViaTransaction() returns PDR from database if query result is empty', async (t) => {
  const {
    cumulusMessage,
    knex,
    collectionCumulusId,
    providerCumulusId,
    executionCumulusId,
    runningPdrRecord,
  } = t.context;

  const fakePdrPgModel = {
    get: (_, record) => {
      if (record.name === runningPdrRecord.name) {
        return Promise.resolve(runningPdrRecord);
      }
      return Promise.resolve();
    },
    upsert: () => Promise.resolve([]),
  };

  const pdr = await writePdrViaTransaction({
    cumulusMessage,
    trx: knex,
    collectionCumulusId,
    providerCumulusId,
    executionCumulusId,
    pdrPgModel: fakePdrPgModel,
    updatedAt: Date.now(),
  });

  t.is(runningPdrRecord, pdr);
});

test.serial('writePdr() returns true if there is no PDR on the message', async (t) => {
  const {
    cumulusMessage,
    knex,
    collectionCumulusId,
    providerCumulusId,
  } = t.context;

  delete cumulusMessage.payload.pdr;

  t.is(
    await writePdr({
      cumulusMessage,
      collectionCumulusId,
      providerCumulusId,
      knex,
    }),
    undefined
  );
});

test.serial('writePdr() throws an error if collection is not provided', async (t) => {
  const { cumulusMessage, knex, providerCumulusId } = t.context;
  await t.throwsAsync(
    writePdr({
      cumulusMessage,
      collectionCumulusId: undefined,
      providerCumulusId,
      knex,
    })
  );
});

test.serial('writePdr() throws an error if provider is not provided', async (t) => {
  const { cumulusMessage, knex, collectionCumulusId } = t.context;
  await t.throwsAsync(
    writePdr({
      cumulusMessage,
      collectionCumulusId,
      providerCumulusId: undefined,
      knex,
    })
  );
});

test.serial('writePdr() does not update PDR record if update is from an older execution', async (t) => {
  const {
    cumulusMessage,
    knex,
    collectionCumulusId,
    providerCumulusId,
    executionCumulusId,
    pdr,
    pdrPgModel,
  } = t.context;

  cumulusMessage.meta.status = 'completed';
  cumulusMessage.payload.running = [];
  cumulusMessage.payload.completed = ['arn1'];
  cumulusMessage.payload.failed = [];

  await writePdr({
    cumulusMessage,
    collectionCumulusId,
    providerCumulusId,
    executionCumulusId: executionCumulusId,
    knex,
  });

  const pgRecord = await pdrPgModel.get(knex, { name: pdr.name });
  const esRecord = await t.context.esPdrClient.get(pdr.name);

  const stats = {
    processing: 0,
    total: 1,
  };
  t.like(pgRecord, {
    status: 'completed',
    stats,
  });
  t.like(esRecord, {
    status: 'completed',
    stats,
  });

  cumulusMessage.meta.status = 'running';
  cumulusMessage.payload.running = ['arn2'];
  cumulusMessage.payload.completed = [];
  cumulusMessage.payload.failed = [];

  await writePdr({
    cumulusMessage,
    collectionCumulusId,
    providerCumulusId,
    executionCumulusId: executionCumulusId,
    knex,
  });

  const updatedPgRecord = await pdrPgModel.get(knex, { name: pdr.name });
  const updatedEsRecord = await t.context.esPdrClient.get(pdr.name);
  t.like(updatedPgRecord, {
    status: 'completed',
    stats,
  });
  t.like(updatedEsRecord, {
    status: 'completed',
    stats,
  });
});

test.serial('writePdr() saves a PDR record to PostgreSQL/Elasticsearch if PostgreSQL write is enabled', async (t) => {
  const {
    cumulusMessage,
    knex,
    collectionCumulusId,
    providerCumulusId,
    executionCumulusId,
    pdr,
    pdrPgModel,
  } = t.context;

  await writePdr({
    cumulusMessage,
    collectionCumulusId,
    providerCumulusId,
    executionCumulusId: executionCumulusId,
    knex,
  });

  t.true(await pdrPgModel.exists(knex, { name: pdr.name }));
  t.true(await t.context.esPdrClient.exists(pdr.name));
});

test.serial('writePdr() saves a PDR record to PostgreSQL/Elasticsearch with same timestamps', async (t) => {
  const {
    cumulusMessage,
    knex,
    collectionCumulusId,
    providerCumulusId,
    executionCumulusId,
    pdr,
    pdrPgModel,
  } = t.context;

  await writePdr({
    cumulusMessage,
    collectionCumulusId,
    providerCumulusId,
    executionCumulusId: executionCumulusId,
    knex,
  });

  const pgRecord = await pdrPgModel.get(knex, { name: pdr.name });
  const esRecord = await t.context.esPdrClient.get(pdr.name);
  t.is(pgRecord.created_at.getTime(), esRecord.createdAt);
  t.is(pgRecord.updated_at.getTime(), esRecord.updatedAt);
});

test.serial('writePdr() does not write to PostgreSQL/Elasticsearch if PostgreSQL write fails', async (t) => {
  const {
    cumulusMessage,
    knex,
    collectionCumulusId,
    providerCumulusId,
    pdrPgModel,
  } = t.context;

  const pdr = {
    name: cryptoRandomString({ length: 5 }),
    PANSent: false,
    PANmessage: 'test',
  };
  cumulusMessage.payload = {
    pdr,
  };

  cumulusMessage.meta.status = 'completed';

  const fakeTrxCallback = (cb) => {
    const fakeTrx = sinon.stub().returns({
      insert: () => {
        throw new Error('PDR RDS error');
      },
    });
    return cb(fakeTrx);
  };
  const trxStub = sinon.stub(knex, 'transaction').callsFake(fakeTrxCallback);
  t.teardown(() => trxStub.restore());

  await t.throwsAsync(
    writePdr({
      cumulusMessage,
      collectionCumulusId,
      providerCumulusId,
      knex,
    }),
    { message: 'PDR RDS error' }
  );

  t.false(await pdrPgModel.exists(knex, { name: pdr.name }));
  t.false(await t.context.esPdrClient.exists(pdr.name));
});

test.serial('writePdr() does not write to PostgreSQL/Elasticsearch if Elasticsearch write fails', async (t) => {
  const {
    cumulusMessage,
    knex,
    collectionCumulusId,
    providerCumulusId,
    pdrPgModel,
  } = t.context;

  const pdr = {
    name: cryptoRandomString({ length: 5 }),
    PANSent: false,
    PANmessage: 'test',
  };
  cumulusMessage.payload = {
    pdr,
  };

  cumulusMessage.meta.status = 'completed';

  const fakeEsClient = {
    initializeEsClient: () => Promise.resolve(),
    client: {
      update: () => {
        throw new Error('PDR ES error');
      },
    },
  };

  await t.throwsAsync(
    writePdr({
      cumulusMessage,
      collectionCumulusId,
      providerCumulusId,
      knex,
      esClient: fakeEsClient,
    }),
    { message: 'PDR ES error' }
  );

  t.false(await pdrPgModel.exists(knex, { name: pdr.name }));
  t.false(await t.context.esPdrClient.exists(pdr.name));
});

test.serial('writePdr() successfully publishes an SNS message', async (t) => {
  const {
    cumulusMessage,
    knex,
    collectionCumulusId,
    providerCumulusId,
    executionCumulusId,
    pdr,
    pdrPgModel,
    QueueUrl,
  } = t.context;

  await writePdr({
    cumulusMessage,
    collectionCumulusId,
    providerCumulusId,
    executionCumulusId: executionCumulusId,
    knex,
  });

  const { Messages } = await sqs().receiveMessage({ QueueUrl, WaitTimeSeconds: 10 });

  t.is(Messages.length, 1);

  const snsMessage = JSON.parse(Messages[0].Body);
  const pdrRecord = JSON.parse(snsMessage.Message);
  const pgRecord = await pdrPgModel.get(knex, { name: pdr.name });
  const translatedRecord = await translatePostgresPdrToApiPdr(pgRecord, knex);

  t.is(pdrRecord.pdrName, pdr.name);
  t.is(pdrRecord.status, cumulusMessage.meta.status);
  t.deepEqual(pdrRecord, translatedRecord);
});

test.serial('writePdr() does not publish an SNS message if pdr_sns_topic_arn is not set', async (t) => {
  process.env.pdr_sns_topic_arn = undefined;
  const {
    cumulusMessage,
    knex,
    collectionCumulusId,
    providerCumulusId,
    executionCumulusId,
    QueueUrl,
  } = t.context;

  await t.throwsAsync(
    writePdr({
      cumulusMessage,
      collectionCumulusId,
      providerCumulusId,
      executionCumulusId: executionCumulusId,
      knex,
    }),
    { message: /Invalid parameter: TopicArn/ }
  );
  const { Messages } = await sqs().send(
    new ReceiveMessageCommand({ QueueUrl, WaitTimeSeconds: 10 })
  );
  t.is(Messages.length, 0);
});
