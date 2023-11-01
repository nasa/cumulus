'use strict';

const orderBy = require('lodash/orderBy');
const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const sinon = require('sinon');
const sortBy = require('lodash/sortBy');
const omit = require('lodash/omit');

const StepFunctions = require('@cumulus/aws-client/StepFunctions');
const { randomId } = require('@cumulus/common/test-utils');
const { removeNilProperties } = require('@cumulus/common/util');
const { constructCollectionId } = require('@cumulus/message/Collections');
const {
  CollectionPgModel,
  ProviderPgModel,
  ExecutionPgModel,
  GranulesExecutionsPgModel,
  GranulePgModel,
  FilePgModel,
  PdrPgModel,
  fakeCollectionRecordFactory,
  fakeExecutionRecordFactory,
  fakeFileRecordFactory,
  fakeGranuleRecordFactory,
  fakeProviderRecordFactory,
  fakePdrRecordFactory,
  generateLocalTestDb,
  destroyLocalTestDb,
  TableNames,
  translatePostgresGranuleToApiGranule,
  translateApiGranuleToPostgresGranule,
  migrationDir,
  createRejectableTransaction,
  translateApiFiletoPostgresFile,
} = require('@cumulus/db');
const {
  sns,
  sqs,
} = require('@cumulus/aws-client/services');
const {
  Search,
} = require('@cumulus/es-client/search');
const {
  createTestIndex,
  cleanupTestIndex,
} = require('@cumulus/es-client/testUtils');
const {
  getExecutionUrlFromArn,
} = require('@cumulus/message/Executions');
const {
  CumulusMessageError,
} = require('@cumulus/errors');

const { sortFilesByBuckets } = require('../../helpers/sort');

const {
  generateFilePgRecord,
  getGranuleFromQueryResultOrLookup,
  writeFilesViaTransaction,
  writeGranuleFromApi,
  writeGranulesFromMessage,
  _writeGranule,
  updateGranuleStatusToQueued,
  updateGranuleStatusToFailed,
} = require('../../../lib/writeRecords/write-granules');
const { fakeFileFactory, fakeGranuleFactoryV2 } = require('../../../lib/testUtils');

// FUTURE:
// 1. 'created_at' is updated during PUT/PATCH
// 2. 'published' defaults to false if not provided in the payload
// 3. 'duration' comes from the workflow and will be reset on update
// 4. 'product_volume' comes from a files object on the payload, which may not exist
//   in the case of partial granule updates
const cumulusMessageOmitList = [
  'cumulus_id',
  'updated_at',
  'created_at',
  'published',
  'timestamp',
  'duration',
  'product_volume',
];

// FUTURE:
// 1. 'created_at' is updated during PUT/PATCH
// 2. 'published' defaults to false if not provided in the payload
const pgFormatOmitList = [
  'cumulus_id',
  'updated_at',
  'created_at',
  'published',
  'timestamp',
];

const apiFormatOmitList = [
  'updatedAt',
  'createdAt',
  'published',
  'timestamp',
];

/**
 * Helper function for updating an existing granule with a static payload and validating
 *
 * @param {Object} t -- Used for the test context
 * @param {Object} updateGranulePayload -- Request body for granule update
 * @param {boolean} granuleWriteVia -- Either 'api' (default) or 'message'. Switches
 *   The granule write mechanism
 * @returns {Object} -- Updated granule objects from each datastore and PG-translated payload
 *   updatedPgGranuleFields,
 *   pgGranule,
 *   esGranule,
 *   dynamoGranule,
 **/
const updateGranule = async (t, updateGranulePayload, granuleWriteVia = 'api') => {
  const {
    collectionCumulusId,
    esClient,
    esGranulesClient,
    executionCumulusId,
    granuleId,
    granulePgModel,
    providerCumulusId,
    knex,
  } = t.context;

  if (granuleWriteVia === 'message') {
    const updatedCumulusMessage = {
      cumulus_meta: {
        workflow_start_time: t.context.workflowStartTime,
        state_machine: t.context.stateMachineArn,
        execution_name: t.context.executionName,
      },
      meta: {
        status: 'completed', // FUTURE: A 'running' state will trigger an insert, not an update
        collection: t.context.collection,
        provider: t.context.provider,
      },
      payload: {
        granules: [updateGranulePayload],
        pdr: { name: t.context.pdrName },
      },
    };
    await writeGranulesFromMessage({
      cumulusMessage: updatedCumulusMessage,
      executionCumulusId,
      providerCumulusId,
      knex,
      testOverrides: { stepFunctionUtils: t.context.stepFunctionUtils },
    });
  } else {
    await writeGranuleFromApi({ ...updateGranulePayload }, knex, esClient, 'Update');
  }
  const pgGranule = await granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );
  const esGranule = await esGranulesClient.get(granuleId);

  const updatedPgGranuleFields = await translateApiGranuleToPostgresGranule({
    dynamoRecord: { ...updateGranulePayload },
    knexOrTransaction: knex,
  });

  return {
    updatedPgGranuleFields,
    pgGranule,
    esGranule,
  };
};

const createGranuleExecution = async (t, status, stateMachineName) => {
  const executionName = cryptoRandomString({ length: 5 });
  const executionArn = `arn:aws:states:us-east-1:12345:execution:${stateMachineName}:${executionName}`;
  const executionUrl = getExecutionUrlFromArn(executionArn);
  const execution = fakeExecutionRecordFactory({
    arn: executionArn,
    url: executionUrl,
    status,
  });

  const [pgExecution] = await t.context.executionPgModel.create(
    t.context.knex,
    execution
  );
  return { pgExecution, executionName, executionUrl };
};

test.before(async (t) => {
  t.context.stepFunctionUtils = {
    ...StepFunctions,
    describeExecution: () => Promise.resolve({}),
  };

  t.context.pdrPgModel = new PdrPgModel();
  t.context.collectionPgModel = new CollectionPgModel();
  t.context.executionPgModel = new ExecutionPgModel();
  t.context.granulePgModel = new GranulePgModel();
  t.context.filePgModel = new FilePgModel();
  t.context.granulesExecutionsPgModel = new GranulesExecutionsPgModel();
  t.context.providerPgModel = new ProviderPgModel();
  t.context.testDbName = `writeGranules_${cryptoRandomString({ length: 10 })}`;

  const { knexAdmin, knex } = await generateLocalTestDb(
    t.context.testDbName,
    migrationDir
  );
  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;

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
  const topicName = cryptoRandomString({ length: 10 });
  const { TopicArn } = await sns().createTopic({ Name: topicName }).promise();
  process.env.granule_sns_topic_arn = TopicArn;
  t.context.TopicArn = TopicArn;

  const QueueName = cryptoRandomString({ length: 10 });
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

  t.context.granule = fakeGranuleFactoryV2({
    files: t.context.files,
    granuleId: t.context.granuleId,
    collectionId: constructCollectionId(t.context.collection.name, t.context.collection.version),
    execution: execution.url,
    pdrName: t.context.pdr.name,
  });

  t.context.workflowStartTime = Date.now();
  t.context.cumulusMessage = {
    cumulus_meta: {
      workflow_start_time: t.context.workflowStartTime,
      state_machine: t.context.stateMachineArn,
      execution_name: t.context.executionName,
    },
    meta: {
      status: 'running',
      collection: t.context.collection,
      provider: t.context.provider,
    },
    payload: {
      granules: [t.context.granule],
      pdr: t.context.pdr,
    },
  };
});

test.afterEach.always(async (t) => {
  const { QueueUrl, TopicArn } = t.context;

  await sqs().deleteQueue({ QueueUrl }).promise();
  await sns().deleteTopic({ TopicArn }).promise();

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

test('generateFilePgRecord() adds granule cumulus ID', (t) => {
  const file = {
    bucket: cryptoRandomString({ length: 3 }),
    key: cryptoRandomString({ length: 3 }),
  };
  const record = generateFilePgRecord({ file, granuleCumulusId: 1 });
  t.is(record.granule_cumulus_id, 1);
});

test('getGranuleFromQueryResultOrLookup() returns cumulus ID from database if query result is empty', async (t) => {
  const fakeGranuleCumulusId = Math.floor(Math.random() * 1000);
  const granuleRecord = fakeGranuleRecordFactory({ granule_id: fakeGranuleCumulusId });
  const fakeGranulePgModel = {
    get: (_, record) => {
      if (record.granule_id === granuleRecord.granule_id) {
        return Promise.resolve(granuleRecord);
      }
      return Promise.resolve();
    },
  };

  t.is(
    await getGranuleFromQueryResultOrLookup({
      trx: {},
      queryResult: [],
      granuleRecord,
      granulePgModel: fakeGranulePgModel,
    }),
    granuleRecord
  );
});

test('writeFilesViaTransaction() throws error if any writes fail', async (t) => {
  const { knex } = t.context;

  const fileRecords = [
    fakeFileRecordFactory(),
    fakeFileRecordFactory(),
  ];

  const fakeFilePgModel = {
    upsert: sinon.stub()
      .onCall(0)
      .resolves()
      .onCall(1)
      .throws(),
  };

  await t.throwsAsync(
    createRejectableTransaction(
      knex,
      (trx) =>
        writeFilesViaTransaction({
          fileRecords,
          trx,
          filePgModel: fakeFilePgModel,
        })
    )
  );
});

test.serial('_writeGranule will not allow a running status to replace a completed status for same execution', async (t) => {
  const {
    granule,
    executionCumulusId,
    esClient,
    collectionCumulusId,
    executionUrl,
    granuleId,
    granulePgModel,
    knex,
  } = t.context;

  const apiGranuleRecord = {
    ...granule,
    status: 'completed',
  };
  const postgresGranuleRecord = await translateApiGranuleToPostgresGranule({
    dynamoRecord: apiGranuleRecord,
    knexOrTransaction: knex,
  });
  await _writeGranule({
    apiGranuleRecord,
    postgresGranuleRecord,
    executionCumulusId,
    granulePgModel,
    knex,
    esClient,
    snsEventType: 'Update',
  });

  const granulePgRecord = await t.context.granulePgModel.get(knex, {
    granule_id: granuleId,
    collection_cumulus_id: collectionCumulusId,
  });
  t.like(
    granulePgRecord,
    {
      status: 'completed',
    }
  );
  t.is(
    (await t.context.granulesExecutionsPgModel.search(
      t.context.knex,
      {
        granule_cumulus_id: granulePgRecord.cumulus_id,
      }
    )).length,
    1
  );
  t.like(
    await t.context.esGranulesClient.get(granuleId),
    {
      execution: executionUrl,
      status: 'completed',
    }
  );

  const updatedapiGranuleRecord = {
    ...granule,
    status: 'running',
  };

  let updatedPgGranuleRecord = await translateApiGranuleToPostgresGranule({
    dynamoRecord: updatedapiGranuleRecord,
    knexOrTransaction: knex,
  });

  updatedPgGranuleRecord = {
    ...updatedPgGranuleRecord,
    cumulus_id: granulePgRecord.cumulus_id,
  };

  await _writeGranule({
    apiGranuleRecord: updatedapiGranuleRecord,
    postgresGranuleRecord: updatedPgGranuleRecord,
    executionCumulusId,
    granulePgModel,
    knex,
    esClient,
    snsEventType: 'Update',
  });

  t.like(
    await t.context.granulePgModel.get(knex, {
      granule_id: granuleId,
      collection_cumulus_id: collectionCumulusId,
    }),
    {
      status: 'completed',
    }
  );
  t.like(
    await t.context.esGranulesClient.get(granuleId),
    {
      execution: executionUrl,
      status: 'completed',
    }
  );
});

test.serial('writeGranulesFromMessage() returns undefined if message has no granules', async (t) => {
  const {
    knex,
    executionCumulusId,
    providerCumulusId,
    stepFunctionUtils,
  } = t.context;
  const cumulusMessage = {};
  const actual = await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    testOverrides: { stepFunctionUtils },
  });
  t.is(actual, undefined);
});

test.serial('writeGranulesFromMessage() returns undefined if message has empty granule set', async (t) => {
  const {
    knex,
    executionCumulusId,
    providerCumulusId,
    stepFunctionUtils,
  } = t.context;
  const cumulusMessage = { granules: [] };
  const actual = await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    testOverrides: { stepFunctionUtils },
  });
  t.is(actual, undefined);
});

test.serial('writeGranulesFromMessage() saves granule records to PostgreSQL/Elasticsearch/SNS', async (t) => {
  const {
    cumulusMessage,
    esGranulesClient,
    granule,
    granulePgModel,
    knex,
    collectionCumulusId,
    executionCumulusId,
    providerCumulusId,
    granuleId,
    stepFunctionUtils,
  } = t.context;

  // Message must be completed or files will not update
  cumulusMessage.meta.status = 'completed';

  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    testOverrides: { stepFunctionUtils },
  });

  t.true(await t.context.granulePgModel.exists(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  ));
  const postgresRecord = await granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );
  const esRecord = await esGranulesClient.get(granuleId);
  const expectedGranule = {
    ...granule,
    createdAt: esRecord.createdAt,
    duration: esRecord.duration,
    error: {},
    productVolume: esRecord.productVolume,
    status: cumulusMessage.meta.status,
    timestamp: esRecord.timestamp,
    updatedAt: esRecord.updatedAt,
  };
  t.like(esRecord, expectedGranule);

  const postgresActual = await translatePostgresGranuleToApiGranule({
    knexOrTransaction: knex,
    granulePgRecord: postgresRecord,
  });

  t.like(
    { ...postgresActual, files: orderBy(postgresActual.files, ['bucket', 'key']) },
    { ...expectedGranule, files: orderBy(expectedGranule.files, ['bucket', 'key']) }
  );

  const { Messages } = await sqs().receiveMessage({
    QueueUrl: t.context.QueueUrl,
    WaitTimeSeconds: 10,
  }).promise();
  t.is(Messages.length, 1);
});

test.serial('writeGranulesFromMessage() on re-write saves granule records to PostgreSQL/Elasticsearch/SNS with expected values nullified', async (t) => {
  const {
    collection,
    collectionCumulusId,
    cumulusMessage,
    esGranulesClient,
    executionCumulusId,
    executionUrl,
    files,
    granulePgModel,
    knex,
    pdr,
    provider,
    providerCumulusId,
    stepFunctionUtils,
  } = t.context;

  const validNullableGranuleKeys = [
    'beginningDateTime',
    'cmrLink',
    'createdAt',
    'duration',
    'endingDateTime',
    'lastUpdateDateTime',
    'pdrName',
    'processingEndDateTime',
    'processingStartDateTime',
    'productionDateTime',
    'productVolume',
    'provider',
    'published',
    'queryFields',
    'timestamp',
    'timeToArchive',
    'timeToPreprocess',
    'updatedAt',
  ];

  const completeGranule = fakeGranuleFactoryV2({
    beginningDateTime: new Date().toISOString(),
    cmrLink: 'example.com',
    collectionId: constructCollectionId(collection.name, collection.version),
    createdAt: Date.now(),
    duration: 1000,
    endingDateTime: new Date().toISOString(),
    error: { errorKey: 'errorValue' },
    execution: executionUrl,
    files: files,
    lastUpdateDateTime: new Date().toISOString(),
    pdrName: pdr.name,
    processingEndDateTime: new Date().toISOString(),
    processingStartDateTime: new Date().toISOString(),
    productionDateTime: new Date().toISOString(),
    productVolume: '1000',
    provider: provider.name,
    published: true,
    queryFields: { queryFieldsKey: 'queryFieldsValue' },
    status: 'completed',
    timestamp: 1,
    timeToArchive: 1000,
    timeToPreprocess: 1000,
    updatedAt: Date.now(),
  });

  const granuleId = completeGranule.granuleId;

  // Message must be completed or files will not update
  cumulusMessage.meta.status = 'completed';
  cumulusMessage.payload.granules[0] = completeGranule;

  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    testOverrides: { stepFunctionUtils },
  });

  t.true(
    await granulePgModel.exists(knex, {
      granule_id: completeGranule.granuleId,
      collection_cumulus_id: collectionCumulusId,
    })
  );
  t.true(await esGranulesClient.exists(completeGranule.granuleId));
  validNullableGranuleKeys.forEach((key) => {
    completeGranule[key] = null;
  });
  cumulusMessage.payload.granules[0] = completeGranule;
  cumulusMessage.cumulus_meta.workflow_start_time = Date.now();
  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    testOverrides: { stepFunctionUtils },
  });

  const postgresRecord = await granulePgModel.get(knex, {
    granule_id: granuleId,
    collection_cumulus_id: collectionCumulusId,
  });
  const apiFormattedPostgresGranule =
    await translatePostgresGranuleToApiGranule({
      granulePgRecord: postgresRecord,
      knexOrTransaction: knex,
    });
  const esRecord = await esGranulesClient.get(granuleId);

  const expectedGranule = {
    ...completeGranule,
    // apiFormatOmitList -- values to be set as they're not nullable/set by default for all writes
    createdAt: apiFormattedPostgresGranule.createdAt,
    published: false,
    timestamp: apiFormattedPostgresGranule.timestamp,
    updatedAt: apiFormattedPostgresGranule.updatedAt,
    // Values to be set as they're not nullable/set
    // by default for all writes (based on message info)'
    duration: apiFormattedPostgresGranule.duration,
    error: {}, // nullish default
    pdrName: cumulusMessage.payload.pdr.name,
    productVolume: String(
      cumulusMessage.payload.granules[0].files.reduce(
        (pv, cv) => cv.size + pv,
        0
      )
    ),
    status: cumulusMessage.meta.status,
    // These values are set *only* via finder methods in the message, and override
    // the passed in granule value.   The factory leaves these unset, so they default to zero
    timeToArchive: 0,
    timeToPreprocess: 0,
  };

  // Files array order is not promised to match between datastores
  [esRecord, expectedGranule, apiFormattedPostgresGranule].forEach((record) => {
    record.files.sort((f1, f2) => sortFilesByBuckets(f1, f2));
  });

  // Translated postgres granule matches expected updatedGranule
  // minus model defaults
  t.deepEqual(
    apiFormattedPostgresGranule,
    removeNilProperties(expectedGranule)
  );
  t.deepEqual(omit(esRecord, ['_id']), removeNilProperties(expectedGranule));
});

test.serial('writeGranulesFromMessage() on re-write saves granule records to PostgreSQL/Elasticsearch/SNS without updating product volume if files is undefined', async (t) => {
  const {
    collection,
    collectionCumulusId,
    cumulusMessage,
    esGranulesClient,
    executionCumulusId,
    executionUrl,
    files,
    granulePgModel,
    knex,
    providerCumulusId,
    stepFunctionUtils,
  } = t.context;

  const completeGranule = fakeGranuleFactoryV2({
    collectionId: constructCollectionId(collection.name, collection.version),
    execution: executionUrl,
    files: files,
    status: 'completed',
  });

  const granuleId = completeGranule.granuleId;
  cumulusMessage.meta.status = 'completed';
  cumulusMessage.payload.granules[0] = completeGranule;

  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    testOverrides: { stepFunctionUtils },
  });

  const initialPostgresRecord = await granulePgModel.get(knex, {
    granule_id: granuleId,
    collection_cumulus_id: collectionCumulusId,
  });

  const apiFormattedInitialPostgresGranule =
    await translatePostgresGranuleToApiGranule({
      granulePgRecord: initialPostgresRecord,
      knexOrTransaction: knex,
    });

  cumulusMessage.payload.granules[0] = { ...apiFormattedInitialPostgresGranule, files: undefined };
  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    testOverrides: { stepFunctionUtils },
  });

  const postgresRecord = await granulePgModel.get(knex, {
    granule_id: granuleId,
    collection_cumulus_id: collectionCumulusId,
  });
  const apiFormattedPostgresGranule =
    await translatePostgresGranuleToApiGranule({
      granulePgRecord: postgresRecord,
      knexOrTransaction: knex,
    });
  const esRecord = await esGranulesClient.get(granuleId);

  t.is(esRecord.productVolume, '15');
  t.is(apiFormattedPostgresGranule.productVolume, '15');
});

test.serial('writeGranulesFromMessage() on re-write saves granule records to PostgreSQL/Elasticsearch/SNS without modifying undefined values', async (t) => {
  const {
    collection,
    collectionCumulusId,
    cumulusMessage,
    esGranulesClient,
    executionCumulusId,
    executionUrl,
    files,
    granulePgModel,
    knex,
    pdr,
    provider,
    providerCumulusId,
    stepFunctionUtils,
  } = t.context;

  const completeGranule = fakeGranuleFactoryV2({
    beginningDateTime: new Date().toISOString(),
    cmrLink: 'example.com',
    collectionId: constructCollectionId(collection.name, collection.version),
    createdAt: Date.now(),
    duration: 1000,
    endingDateTime: new Date().toISOString(),
    error: { errorKey: 'errorValue' },
    execution: executionUrl,
    files: files,
    lastUpdateDateTime: new Date().toISOString(),
    pdrName: pdr.name,
    processingEndDateTime: new Date().toISOString(),
    processingStartDateTime: new Date().toISOString(),
    productionDateTime: new Date().toISOString(),
    productVolume: '1000',
    provider: provider.name,
    published: true,
    queryFields: { queryFieldsKey: 'queryFieldsValue' },
    status: 'completed',
    timestamp: 1,
    timeToArchive: 1000,
    timeToPreprocess: 1000,
    updatedAt: Date.now(),
  });

  const granuleId = completeGranule.granuleId;

  // Message must be completed or files will not update
  cumulusMessage.meta.status = 'completed';
  cumulusMessage.payload.granules[0] = completeGranule;

  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    testOverrides: { stepFunctionUtils },
  });

  t.true(
    await granulePgModel.exists(knex, {
      granule_id: completeGranule.granuleId,
      collection_cumulus_id: collectionCumulusId,
    })
  );
  t.true(await esGranulesClient.exists(completeGranule.granuleId));

  const initialPostgresRecord = await granulePgModel.get(knex, {
    granule_id: granuleId,
    collection_cumulus_id: collectionCumulusId,
  });
  const apiFormattedInitialPostgresGranule =
    await translatePostgresGranuleToApiGranule({
      granulePgRecord: initialPostgresRecord,
      knexOrTransaction: knex,
    });

  cumulusMessage.payload.granules[0] = { granuleId: completeGranule.granuleId };
  cumulusMessage.cumulus_meta.workflow_start_time = Date.now();
  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    testOverrides: { stepFunctionUtils },
  });

  const postgresRecord = await granulePgModel.get(knex, {
    granule_id: granuleId,
    collection_cumulus_id: collectionCumulusId,
  });
  const apiFormattedPostgresGranule =
    await translatePostgresGranuleToApiGranule({
      granulePgRecord: postgresRecord,
      knexOrTransaction: knex,
    });
  const esRecord = await esGranulesClient.get(granuleId);

  const expectedGranule = {
    ...apiFormattedInitialPostgresGranule,
    // These values *must* be set or the message write logic sets them.
    createdAt: apiFormattedPostgresGranule.createdAt,
    published: false,
    timestamp: apiFormattedPostgresGranule.timestamp,
    updatedAt: apiFormattedPostgresGranule.updatedAt,
    // Values to be set as they're set by default for all writes (based on message info)
    duration: apiFormattedPostgresGranule.duration,
    pdrName: cumulusMessage.payload.pdr.name,
    status: cumulusMessage.meta.status,
    // These values are set *only* via finder methods in the message, and override
    // the passed in granule value.   The factory leaves these unset, so they default to zero
    timeToArchive: 0,
    timeToPreprocess: 0,
  };

  // Files array order is not promised to match between datastores
  [esRecord, expectedGranule, apiFormattedPostgresGranule].forEach((record) => {
    record.files.sort((f1, f2) => sortFilesByBuckets(f1, f2));
  });

  // Translated postgres granule matches expected updatedGranule
  // minus model defaults
  t.deepEqual(
    apiFormattedPostgresGranule,
    removeNilProperties(expectedGranule)
  );
  t.deepEqual(omit(esRecord, ['_id']), removeNilProperties(expectedGranule));
});

test.serial('writeGranulesFromMessage() on re-write saves granule records to PostgreSQL/Elasticsearch/SNS with expected values nullified when granule is updated to running', async (t) => {
  const {
    collection,
    collectionCumulusId,
    cumulusMessage,
    esGranulesClient,
    executionCumulusId,
    files,
    granulePgModel,
    knex,
    pdr,
    provider,
    providerCumulusId,
    stepFunctionUtils,
  } = t.context;

  const validNullableGranuleKeys = [
    'beginningDateTime',
    'cmrLink',
    'createdAt',
    'duration',
    'endingDateTime',
    'lastUpdateDateTime',
    'pdrName',
    'processingEndDateTime',
    'processingStartDateTime',
    'productionDateTime',
    'productVolume',
    'provider',
    'published',
    'queryFields',
    'timestamp',
    'timeToArchive',
    'timeToPreprocess',
    'updatedAt',
  ];

  const completeGranule = fakeGranuleFactoryV2({
    beginningDateTime: new Date().toISOString(),
    cmrLink: 'example.com',
    collectionId: constructCollectionId(collection.name, collection.version),
    duration: 1000,
    endingDateTime: new Date().toISOString(),
    error: { errorKey: 'errorValue' },
    files: files,
    lastUpdateDateTime: new Date().toISOString(),
    pdrName: pdr.name,
    processingEndDateTime: new Date().toISOString(),
    processingStartDateTime: new Date().toISOString(),
    productionDateTime: new Date().toISOString(),
    productVolume: '1000',
    provider: provider.name,
    published: true,
    queryFields: { queryFieldsKey: 'queryFieldsValue' },
    status: 'completed',
    timeToArchive: 1000,
    timeToPreprocess: 1000,
    updatedAt: Date.now(),
  });

  const granuleId = completeGranule.granuleId;

  // Message must be completed or files will not update
  cumulusMessage.meta.status = 'completed';
  cumulusMessage.payload.granules[0] = completeGranule;

  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    testOverrides: { stepFunctionUtils },
  });

  const originalPostgresGranuleRecord = await granulePgModel.get(knex, {
    granule_id: granuleId,
    collection_cumulus_id: collectionCumulusId,
  });
  const originalApiFormattedPostgresGranule =
    await translatePostgresGranuleToApiGranule({
      granulePgRecord: originalPostgresGranuleRecord,
      knexOrTransaction: knex,
    });
  const { executionName, pgExecution, executionUrl } = await createGranuleExecution(t, 'running', t.context.stateMachineName);

  const updatedGranule = {
    ...completeGranule,
    timestamp: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    execution: executionName,
  };

  validNullableGranuleKeys.forEach((key) => {
    updatedGranule[key] = null;
  });
  cumulusMessage.payload.granules[0] = updatedGranule;
  cumulusMessage.cumulus_meta.workflow_start_time = Date.now();
  cumulusMessage.meta.status = 'running';
  cumulusMessage.cumulus_meta.execution_name = executionName;

  await writeGranulesFromMessage({
    cumulusMessage,
    providerCumulusId,
    knex,
    executionCumulusId: pgExecution.cumulus_id,
    testOverrides: { stepFunctionUtils },
  });

  const postgresRecord = await granulePgModel.get(knex, {
    granule_id: granuleId,
    collection_cumulus_id: collectionCumulusId,
  });
  const apiFormattedPostgresGranule =
    await translatePostgresGranuleToApiGranule({
      granulePgRecord: postgresRecord,
      knexOrTransaction: knex,
    });
  const esRecord = await esGranulesClient.get(granuleId);

  // We expect nothing other than these fields to change because of the write rules:
  const expectedGranule = {
    ...originalApiFormattedPostgresGranule,
    createdAt: cumulusMessage.cumulus_meta.workflow_start_time,
    timestamp: apiFormattedPostgresGranule.timestamp,
    updatedAt: apiFormattedPostgresGranule.updatedAt,
    status: cumulusMessage.meta.status,
    execution: executionUrl,
  };

  // Files array order is not promised to match between datastores
  [esRecord, expectedGranule, apiFormattedPostgresGranule].forEach((record) => {
    record.files.sort((f1, f2) => sortFilesByBuckets(f1, f2));
  });

  // Translated postgres granule matches expected updatedGranule
  // minus model defaults
  t.deepEqual(
    apiFormattedPostgresGranule,
    expectedGranule
  );
  t.deepEqual(omit(esRecord, ['_id']), expectedGranule);
});

test.serial('writeGranulesFromMessage() saves the same values to PostgreSQL and Elasticsearch', async (t) => {
  const {
    collectionCumulusId,
    cumulusMessage,
    executionCumulusId,
    granuleId,
    knex,
    providerCumulusId,
    stepFunctionUtils,
  } = t.context;

  // Only test fields that are stored in Postgres on the Granule record.
  // The following fields are populated by separate queries during translation
  // or elasticsearch.
  const omitList = ['files', '_id'];

  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    knex,
    providerCumulusId,
    testOverrides: { stepFunctionUtils },
  });

  const granulePgRecord = await t.context.granulePgModel.get(
    knex,
    {
      granule_id: granuleId,
      collection_cumulus_id: collectionCumulusId,
    }
  );

  // translate the PG granule to API granule to directly compare to elasticsearch
  const translatedPgRecord = await translatePostgresGranuleToApiGranule({
    granulePgRecord,
    knexOrTransaction: knex,
  });

  const esRecord = await t.context.esGranulesClient.get(granuleId);
  t.deepEqual(omit(translatedPgRecord, omitList), omit(esRecord, omitList));
});

test.serial('writeGranulesFromMessage() sets a default value of false for `published` if one is not set', async (t) => {
  const {
    collectionCumulusId,
    cumulusMessage,
    knex,
    executionCumulusId,
    providerCumulusId,
    granuleId,
    stepFunctionUtils,
  } = t.context;

  // Only test fields that are stored in Postgres on the Granule record.
  // The following fields are populated by separate queries during translation
  // or elasticsearch.
  const omitList = ['files', '_id'];

  // Remove published key for test
  delete cumulusMessage.payload.granules[0].published;

  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    testOverrides: { stepFunctionUtils },
  });

  const granulePgRecord = await t.context.granulePgModel.get(
    knex,
    {
      granule_id: granuleId,
      collection_cumulus_id: collectionCumulusId,
    }
  );

  // Validate objects all match
  /// translate the PG granule to API granule to directly compare to ES
  const translatedPgRecord = await translatePostgresGranuleToApiGranule({
    granulePgRecord,
    knexOrTransaction: knex,
  });

  const esRecord = await t.context.esGranulesClient.get(granuleId);
  t.deepEqual(omit(translatedPgRecord, omitList), omit(esRecord, omitList));

  // Validate assertion is true in the primary datastore:

  t.is(translatedPgRecord.published, false);
});

test.serial('writeGranulesFromMessage() uses a default value for granule.createdAt from workflowStartTime if granule.createdAt is undefined', async (t) => {
  const {
    collectionCumulusId,
    cumulusMessage,
    executionCumulusId,
    granuleId,
    knex,
    providerCumulusId,
    workflowStartTime,
    stepFunctionUtils,
  } = t.context;

  // Only test fields that are stored in Postgres on the Granule record.
  // The following fields are populated by separate queries during translation
  // or elasticsearch.
  const omitList = ['files', '_id'];

  // Remove createdAt key for test
  delete cumulusMessage.payload.granules[0].createdAt;

  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    testOverrides: { stepFunctionUtils },
  });

  const granulePgRecord = await t.context.granulePgModel.get(
    knex,
    {
      granule_id: granuleId,
      collection_cumulus_id: collectionCumulusId,
    }
  );

  // Validate objects all match
  /// translate the PG granule to API granule to directly compare to ES
  const translatedPgRecord = await translatePostgresGranuleToApiGranule({
    granulePgRecord,
    knexOrTransaction: knex,
  });

  const esRecord = await t.context.esGranulesClient.get(granuleId);
  t.deepEqual(omit(translatedPgRecord, omitList), omit(esRecord, omitList));

  // Validate assertion is true in the primary datastore:

  t.is(translatedPgRecord.createdAt, workflowStartTime);
});

test.serial('writeGranulesFromMessage() allows overwrite of createdAt and uses granule.createdAt value for written granule if defined', async (t) => {
  const {
    collectionCumulusId,
    cumulusMessage,
    executionCumulusId,
    granuleId,
    knex,
    providerCumulusId,
    stepFunctionUtils,
  } = t.context;

  // Only test fields that are stored in Postgres on the Granule record.
  // The following fields are populated by separate queries during translation
  // or elasticsearch.
  const omitList = ['files', '_id'];

  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    testOverrides: { stepFunctionUtils },
  });

  const granulePgRecord = await t.context.granulePgModel.get(
    knex,
    {
      granule_id: granuleId,
      collection_cumulus_id: collectionCumulusId,
    }
  );

  // Validate objects all match
  /// translate the PG granule to API granule to directly compare to ES
  const translatedPgRecord = await translatePostgresGranuleToApiGranule({
    granulePgRecord,
    knexOrTransaction: knex,
  });

  const esRecord = await t.context.esGranulesClient.get(granuleId);
  t.deepEqual(omit(translatedPgRecord, omitList), omit(esRecord, omitList));

  // Validate assertion is true in the primary datastore:

  t.is(translatedPgRecord.createdAt, cumulusMessage.payload.granules[0].createdAt);
});

test.serial('writeGranulesFromMessage() given a payload with undefined files, keeps existing files in all datastores', async (t) => {
  const {
    collectionCumulusId,
    esGranulesClient,
    files,
    granule,
    granulePgModel,
    knex,
    executionCumulusId,
    providerCumulusId,
    granuleId,
    stepFunctionUtils,
  } = t.context;

  // Need a message in 'completed' state to allow files writes
  const completedCumulusMessage = {
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
      granules: [t.context.granule],
    },
  };

  await writeGranulesFromMessage({
    cumulusMessage: completedCumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    testOverrides: { stepFunctionUtils },
  });

  const originalEsGranule = await esGranulesClient.get(granuleId);
  const originalpgGranule = await granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );
  const originalApiGranule = await translatePostgresGranuleToApiGranule({
    granulePgRecord: originalpgGranule,
    knexOrTransaction: knex,
  });

  const originalPayloadFiles = files;

  originalPayloadFiles.sort(
    (f1, f2) => sortFilesByBuckets(f1, f2)
  );
  originalApiGranule.files.sort(
    (f1, f2) => sortFilesByBuckets(f1, f2)
  );
  originalEsGranule.files.sort(
    (f1, f2) => sortFilesByBuckets(f1, f2)
  );

  // Files were written correctly in initial DB writes
  t.true(originalPayloadFiles.length > 0);
  t.deepEqual(originalEsGranule.files, originalPayloadFiles);
  t.deepEqual(originalApiGranule.files, originalPayloadFiles);

  // Update existing granule with a partial granule object
  const updateGranulePayload = {
    granuleId,
    collectionId: granule.collectionId,
    cmrLink: 'updatedGranuled.com', // Only field we're changing
    status: granule.status,
    // files is undefined
  };

  const {
    pgGranule,
    esGranule,
  } = await updateGranule(t, updateGranulePayload, 'message');

  const apiGranule = await translatePostgresGranuleToApiGranule({
    granulePgRecord: pgGranule,
    knexOrTransaction: knex,
  });

  esGranule.files.sort(
    (f1, f2) => sortFilesByBuckets(f1, f2)
  );
  apiGranule.files.sort(
    (f1, f2) => sortFilesByBuckets(f1, f2)
  );

  t.deepEqual(apiGranule.files, originalPayloadFiles);
  t.deepEqual(esGranule.files, originalPayloadFiles);
});

test.serial('writeGranulesFromMessage() given a partial granule overwrites only provided fields', async (t) => {
  const {
    collectionCumulusId,
    esGranulesClient,
    granule,
    granulePgModel,
    knex,
    executionCumulusId,
    providerCumulusId,
    granuleId,
    stepFunctionUtils,
  } = t.context;

  // Need a message in 'completed' state to allow files writes
  const completedCumulusMessage = {
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
      granules: [t.context.granule],
      pdr: { name: t.context.pdrName },
    },
  };

  await writeGranulesFromMessage({
    cumulusMessage: completedCumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    testOverrides: { stepFunctionUtils },
  });

  t.true(await granulePgModel.exists(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  ));
  t.true(await esGranulesClient.exists(granuleId));

  const originalpgGranule = await granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );

  // Update existing granule with a partial granule object
  const updateGranulePayload = {
    granuleId,
    collectionId: granule.collectionId,
    cmrLink: 'updatedGranuled.com', // Only field we're changing
    status: granule.status,
  };

  const {
    updatedPgGranuleFields,
    pgGranule,
    esGranule,
  } = await updateGranule(t, updateGranulePayload, 'message');

  const apiGranule = await translatePostgresGranuleToApiGranule({
    granulePgRecord: pgGranule,
    knexOrTransaction: knex,
  });

  esGranule.files.sort(
    (f1, f2) => sortFilesByBuckets(f1, f2)
  );
  apiGranule.files.sort(
    (f1, f2) => sortFilesByBuckets(f1, f2)
  );

  // Postgres granule matches expected updatedGranule
  t.deepEqual(
    omit(removeNilProperties(pgGranule), cumulusMessageOmitList),
    omit(
      removeNilProperties({ ...originalpgGranule, ...updatedPgGranuleFields }),
      cumulusMessageOmitList
    )
  );

  // Postgres and ElasticSearch granules matches
  t.deepEqual(
    apiGranule,
    omit(esGranule, ['_id'])
  );
});

test.serial('writeGranulesFromMessage() given an empty array as a files key will remove all existing files and keep Postgres/Elastic in-sync', async (t) => {
  const {
    collectionCumulusId,
    executionCumulusId,
    esGranulesClient,
    files,
    granule,
    granuleId,
    granulePgModel,
    providerCumulusId,
    knex,
    stepFunctionUtils,
  } = t.context;

  // Need a message in 'completed' state to allow files writes
  const completedCumulusMessage = {
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
      granules: [granule],
    },
  };

  await writeGranulesFromMessage({
    cumulusMessage: completedCumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    testOverrides: { stepFunctionUtils },
  });

  const originalEsGranule = await esGranulesClient.get(granuleId);
  const originalpgGranule = await granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );
  const originalApiGranule = await translatePostgresGranuleToApiGranule({
    granulePgRecord: originalpgGranule,
    knexOrTransaction: knex,
  });

  const originalPayloadFiles = files;

  originalPayloadFiles.sort(
    (f1, f2) => sortFilesByBuckets(f1, f2)
  );
  originalApiGranule.files.sort(
    (f1, f2) => sortFilesByBuckets(f1, f2)
  );
  originalEsGranule.files.sort(
    (f1, f2) => sortFilesByBuckets(f1, f2)
  );

  // Files were written correctly in initial DB writes
  t.deepEqual(originalEsGranule.files, originalPayloadFiles);
  t.deepEqual(originalApiGranule.files, originalPayloadFiles);

  // Update existing granule with a partial granule object
  const updateGranulePayload = {
    granuleId,
    collectionId: granule.collectionId,
    files: [],
    status: granule.status,
  };

  const {
    updatedPgGranuleFields,
    pgGranule,
    esGranule,
  } = await updateGranule(t, updateGranulePayload, 'message');

  // Postgres granule matches expected updatedGranule
  t.deepEqual(
    omit(removeNilProperties(pgGranule), cumulusMessageOmitList),
    omit(
      removeNilProperties({ ...originalpgGranule, ...updatedPgGranuleFields }),
      cumulusMessageOmitList
    )
  );

  const apiGranule = await translatePostgresGranuleToApiGranule({
    granulePgRecord: pgGranule,
    knexOrTransaction: knex,
  });

  // Files were removed from all datastores
  t.deepEqual(apiGranule.files, []);
  t.is(esGranule.files, undefined);
});

test.serial('writeGranulesFromMessage() given a null files key will throw an error', async (t) => {
  const {
    collectionCumulusId,
    esGranulesClient,
    granule,
    knex,
    executionCumulusId,
    providerCumulusId,
    granuleId,
    stepFunctionUtils,
  } = t.context;

  // Need a message in 'completed' state to allow files writes
  const completedCumulusMessage = {
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
      granules: [t.context.granule],
    },
  };

  await writeGranulesFromMessage({
    cumulusMessage: completedCumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    testOverrides: { stepFunctionUtils },
  });

  // Files exist in all datastores
  const originalPGGranule = await t.context.granulePgModel.get(
    knex,
    {
      granule_id: granuleId,
      collection_cumulus_id: collectionCumulusId,
    }
  );
  const originalApiGranule = await translatePostgresGranuleToApiGranule({
    granulePgRecord: originalPGGranule,
    knexOrTransaction: knex,
  });
  const originalEsGranule = await esGranulesClient.get(granuleId);
  const originalPayloadFiles = t.context.files;

  originalApiGranule.files.sort(
    (f1, f2) => sortFilesByBuckets(f1, f2)
  );
  originalEsGranule.files.sort(
    (f1, f2) => sortFilesByBuckets(f1, f2)
  );
  originalPayloadFiles.sort(
    (f1, f2) => sortFilesByBuckets(f1, f2)
  );

  t.deepEqual(originalApiGranule.files, originalPayloadFiles);
  t.deepEqual(originalEsGranule.files, originalPayloadFiles);

  // Update existing granule with a partial granule object
  const updateGranulePayload = {
    granuleId,
    collectionId: granule.collectionId,
    files: null,
    status: granule.status,
  };

  const [error] = await t.throwsAsync(updateGranule(t, updateGranulePayload, 'message'));
  t.is(error.message, 'granule.files must not be null');
});

test.serial('writeGranulesFromMessage() removes preexisting granule file from PostgreSQL on granule update with disjoint files', async (t) => {
  const {
    cumulusMessage,
    executionCumulusId,
    filePgModel,
    granule,
    granulePgModel,
    knex,
    stepFunctionUtils,
  } = t.context;

  // Set message status to 'completed' to allow file writes due to current file write constraints
  cumulusMessage.meta.status = 'completed';

  // Create granule in PG with multiple files. These records will exist in database
  // during subsequent granule write from message
  const files = [
    fakeFileFactory({ size: 5 }),
    fakeFileFactory({ size: 5 }),
    fakeFileFactory({ size: 5 }),
    fakeFileFactory({ size: 5 }),
    fakeFileFactory({ size: 5 }),
    fakeFileFactory({ size: 5 }),
  ];
  const existingGranule = fakeGranuleFactoryV2({
    files: files,
    granuleId: cryptoRandomString({ length: 10 }),
    collectionId: constructCollectionId(t.context.collection.name, t.context.collection.version),
  });
  const existingPgGranule = await translateApiGranuleToPostgresGranule({
    dynamoRecord: existingGranule,
    knexOrTransaction: knex,
  });
  const [existingPgGranuleRecord] = await granulePgModel.create(knex, existingPgGranule, '*');

  await Promise.all(files.map(async (file) => {
    const pgFile = await translateApiFiletoPostgresFile(file);
    pgFile.granule_cumulus_id = existingPgGranuleRecord.cumulus_id;
    return filePgModel.create(knex, pgFile);
  }));
  const existingPgFiles = await filePgModel.search(knex, {});

  // Create the message granule and associated file in PG.
  // The fakeFile created here is NOT in the message and will be deleted
  // in writeGranulesFromMessage
  const pgGranule = await translateApiGranuleToPostgresGranule({
    dynamoRecord: granule,
    knexOrTransaction: knex,
  });
  const returnedGranule = await granulePgModel.create(knex, pgGranule, '*');

  const [fakeFile] = await filePgModel.create(knex, {
    granule_cumulus_id: returnedGranule[0].cumulus_id,
    bucket: 'fake_bucket',
    key: 'fake_key',
  }, '*');

  // Ensure fakeFile was added to the files table
  t.true(await filePgModel.exists(knex, { cumulus_id: fakeFile.cumulus_id }));

  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    knex,
    testOverrides: { stepFunctionUtils },
  });

  // Ensure fakeFile was removed
  const updatedPgFiles = await filePgModel.search(knex, {});
  t.deepEqual(updatedPgFiles.filter((file) => file.bucket === fakeFile.bucket), []);

  // We expect the files currently in the File table to be those files
  // that previously existed plus the files from the cumulus message
  const filesFromCumulusMessage = cumulusMessage.payload.granules[0].files.map(
    (file) => file.bucket
  );

  t.deepEqual(
    existingPgFiles.map((file) => file.bucket).concat(filesFromCumulusMessage).sort(),
    updatedPgFiles.map((file) => file.bucket).sort()
  );
});

test.serial('writeGranulesFromMessage() saves granule records to PostgreSQL/Elasticsearch with same timestamps', async (t) => {
  const {
    cumulusMessage,
    knex,
    collectionCumulusId,
    executionCumulusId,
    providerCumulusId,
    granuleId,
    stepFunctionUtils,
  } = t.context;

  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    testOverrides: { stepFunctionUtils },
  });

  const granulePgRecord = await t.context.granulePgModel.get(
    knex,
    {
      granule_id: granuleId,
      collection_cumulus_id: collectionCumulusId,
    }
  );

  const esRecord = await t.context.esGranulesClient.get(granuleId);

  t.is(granulePgRecord.created_at.getTime(), esRecord.createdAt);
  t.is(granulePgRecord.updated_at.getTime(), esRecord.updatedAt);
  t.is(granulePgRecord.timestamp.getTime(), esRecord.timestamp);
});

test.serial('writeGranulesFromMessage() saves the same files to PostgreSQL and Elasticsearch', async (t) => {
  const {
    collectionCumulusId,
    cumulusMessage,
    esGranulesClient,
    executionCumulusId,
    granuleId,
    granulePgModel,
    knex,
    stepFunctionUtils,
  } = t.context;

  // ensure files are written
  cumulusMessage.meta.status = 'completed';

  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    knex,
    testOverrides: { stepFunctionUtils },
  });

  const granulePgRecord = await granulePgModel.get(
    knex,
    {
      granule_id: granuleId,
      collection_cumulus_id: collectionCumulusId,
    }
  );

  // translate the PG granule to API granule to directly compare to Dynamo
  const translatedPgRecord = await translatePostgresGranuleToApiGranule({
    granulePgRecord,
    knexOrTransaction: knex,
  });
  const sortByKeys = ['bucket', 'key'];

  const esRecord = await esGranulesClient.get(granuleId);
  t.deepEqual(sortBy(translatedPgRecord.files, sortByKeys), sortBy(esRecord.files, sortByKeys));
});

test.serial('writeGranulesFromMessage() saves file records to when workflow status is "completed"', async (t) => {
  const {
    collectionCumulusId,
    cumulusMessage,
    executionCumulusId,
    filePgModel,
    files,
    granuleId,
    granulePgModel,
    knex,
    providerCumulusId,
    stepFunctionUtils,
  } = t.context;

  cumulusMessage.meta.status = 'completed';

  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    testOverrides: { stepFunctionUtils },
  });

  const granule = await granulePgModel.get(
    knex,
    {
      granule_id: granuleId,
      collection_cumulus_id: collectionCumulusId,
    }
  );

  const pgFiles = await filePgModel.search(knex, { granule_cumulus_id: granule.cumulus_id });
  files.forEach((file) => {
    const matchingPgFile = pgFiles.find(
      (pgFile) => file.bucket === pgFile.bucket && file.key === pgFile.key
    );
    t.like(
      matchingPgFile,
      {
        bucket: file.bucket,
        key: file.key,
        file_size: `${file.size}`,
      }
    );
  });
});

test.serial('writeGranulesFromMessage() handles successful and failing writes independently', async (t) => {
  const {
    cumulusMessage,
    knex,
    collectionCumulusId,
    executionCumulusId,
    granuleId,
    stepFunctionUtils,
  } = t.context;

  const granule2 = {
    // no granule ID should cause failure
  };
  cumulusMessage.payload.granules = [
    ...cumulusMessage.payload.granules,
    granule2,
  ];

  await t.throwsAsync(writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    knex,
    testOverrides: { stepFunctionUtils },
  }));

  t.true(
    await t.context.granulePgModel.exists(
      knex,
      { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
    )
  );
});

test.serial('writeGranulesFromMessage() throws error if any granule writes fail', async (t) => {
  const {
    cumulusMessage,
    knex,
    executionCumulusId,
    providerCumulusId,
    stepFunctionUtils,
  } = t.context;

  cumulusMessage.payload.granules = [
    ...cumulusMessage.payload.granules,
    // this object is not a valid granule, so its write should fail
    {},
  ];

  await t.throwsAsync(writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    testOverrides: { stepFunctionUtils },
  }));
});

test.serial('writeGranulesFromMessage() does not write to PostgreSQL/Elasticsearch/SNS if Postgres write fails', async (t) => {
  const {
    collectionCumulusId,
    cumulusMessage,
    executionCumulusId,
    granuleId,
    knex,
    providerCumulusId,
    stepFunctionUtils,
  } = t.context;

  const testGranulePgModel = {
    upsert: () => {
      throw new Error('Granules PostgreSQL error');
    },
    exists: () => Promise.resolve(false),
    search: () => Promise.resolve([]),
  };

  const [error] = await t.throwsAsync(writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    granulePgModel: testGranulePgModel,
    knex,
    providerCumulusId,
    testOverrides: { stepFunctionUtils },
  }));

  t.true(error.message.includes('Granules PostgreSQL error'));
  t.false(
    await t.context.granulePgModel.exists(knex, {
      granule_id: granuleId,
      collection_cumulus_id: collectionCumulusId,
    })
  );
  t.false(await t.context.esGranulesClient.exists(granuleId));

  const { Messages } = await sqs().receiveMessage({
    QueueUrl: t.context.QueueUrl,
    WaitTimeSeconds: 10,
  }).promise();
  t.is(Messages, undefined);
});

test.serial('writeGranulesFromMessage() does not persist records to PostgreSQL/Elasticsearch/SNS if Elasticsearch write fails', async (t) => {
  const {
    collectionCumulusId,
    cumulusMessage,
    executionCumulusId,
    granuleId,
    knex,
    providerCumulusId,
    stepFunctionUtils,
  } = t.context;

  const fakeEsClient = {
    update: () => {
      throw new Error('Granules ES error');
    },
    delete: () => Promise.resolve(),
  };

  const [error] = await t.throwsAsync(writeGranulesFromMessage({
    collectionCumulusId,
    cumulusMessage,
    esClient: fakeEsClient,
    executionCumulusId,
    knex,
    providerCumulusId,
    testOverrides: { stepFunctionUtils },
  }));

  t.true(error.message.includes('Granules ES error'));
  t.false(
    await t.context.granulePgModel.exists(
      knex,
      { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
    )
  );
  t.false(await t.context.esGranulesClient.exists(granuleId));

  const { Messages } = await sqs().receiveMessage({
    QueueUrl: t.context.QueueUrl,
    WaitTimeSeconds: 10,
  }).promise();
  t.is(Messages, undefined);
});

test.serial('writeGranulesFromMessage() writes a granule and marks as failed if any file writes fail', async (t) => {
  const {
    cumulusMessage,
    knex,
    collectionCumulusId,
    executionCumulusId,
    providerCumulusId,
    granuleId,
    stepFunctionUtils,
  } = t.context;

  cumulusMessage.meta.status = 'completed';

  cumulusMessage.payload.granules[0].files[0].bucket = undefined;
  cumulusMessage.payload.granules[0].files[0].key = undefined;

  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    testOverrides: { stepFunctionUtils },
  });

  const pgGranule = await t.context.granulePgModel.get(knex, {
    granule_id: granuleId,
    collection_cumulus_id: collectionCumulusId,
  });
  t.is(pgGranule.status, 'failed');
  const pgGranuleError = JSON.parse(pgGranule.error.errors);
  t.deepEqual(pgGranuleError.map((error) => error.Error), ['Failed writing files to PostgreSQL.']);
  t.true(pgGranuleError[0].Cause.includes('AggregateError'));
});

test.serial('writeGranuleFromMessage() writes a new granule with files set to "[]" results in file value set to undefined/default in all datastores', async (t) => {
  const {
    collectionCumulusId,
    cumulusMessage,
    executionCumulusId,
    granuleId,
    granulePgModel,
    knex,
    providerCumulusId,
    stepFunctionUtils,
  } = t.context;

  cumulusMessage.payload.granules[0].files = [];

  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    testOverrides: { stepFunctionUtils },
  });

  const granulePgRecord = await granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );
  const esRecord = await t.context.esGranulesClient.get(granuleId);

  const translatedPgRecord = await translatePostgresGranuleToApiGranule({
    granulePgRecord,
    knexOrTransaction: knex,
  });

  t.deepEqual(translatedPgRecord.files, []);
  t.is(esRecord.files, undefined);
});

test.serial('_writeGranules attempts to mark granule as failed if a SchemaValidationException occurs when a granule is in a final state', async (t) => {
  const {
    collectionCumulusId,
    cumulusMessage,
    executionCumulusId,
    granuleId,
    knex,
    providerCumulusId,
    stepFunctionUtils,
  } = t.context;

  cumulusMessage.meta.status = 'queued';

  // initial write
  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    knex,
    testOverrides: { stepFunctionUtils },
  });

  const originalError = { Error: 'Original Error', Cause: { Error: 'Original Error Cause' } };
  // second write
  // Invalid granule file schema to prevent granule write from succeeding
  cumulusMessage.meta.status = 'completed';
  cumulusMessage.exception = originalError;
  cumulusMessage.payload.granules[0].files = [
    {
      path: 'MYD13Q1.006', size: 170459659, name: 'MYD13Q1.A2017281.h19v11.006.2017297235119.hdf', type: 'data', checksumType: 'CKSUM', checksum: 3129208208,
    },
    { path: 'MYD13Q1.006', size: 46399, name: 'MYD13Q1.A2017281.h19v11.006.2017297235119.hdf.met', type: 'metadata' },
    { path: 'MYD13Q1.006', size: 32795, name: 'BROWSE.MYD13Q1.A2017281.h19v11.006.2017297235119.hdf', type: 'browse' },
  ];

  const [error] = await t.throwsAsync(writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    testOverrides: { stepFunctionUtils },
  }));

  t.true(error.message.includes('The record has validation errors:'));

  const pgGranule = await t.context.granulePgModel.get(knex, {
    granule_id: granuleId,
    collection_cumulus_id: collectionCumulusId,
  });
  t.is(pgGranule.status, 'failed');
});

test.serial('writeGranulesFromMessage() writes all valid files if any non-valid file fails', async (t) => {
  const {
    cumulusMessage,
    executionCumulusId,
    filePgModel,
    granulePgModel,
    knex,
    providerCumulusId,
    stepFunctionUtils,
  } = t.context;

  cumulusMessage.meta.status = 'completed';

  const invalidFiles = [
    fakeFileFactory({ bucket: undefined }),
    fakeFileFactory({ bucket: undefined }),
  ];

  const existingFiles = cumulusMessage.payload.granules[0].files;
  cumulusMessage.payload.granules[0].files = existingFiles.concat(invalidFiles);

  const validFiles = 10;
  for (let i = 0; i < validFiles; i += 1) {
    cumulusMessage.payload.granules[0].files.push(fakeFileFactory());
  }
  const validFileCount = cumulusMessage.payload.granules[0].files.length - invalidFiles.length;

  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    testOverrides: { stepFunctionUtils },
  });

  t.false(await filePgModel.exists(knex, { key: invalidFiles[0].key }));
  t.false(await filePgModel.exists(knex, { key: invalidFiles[1].key }));

  const granuleCumulusId = await granulePgModel.getRecordCumulusId(
    knex,
    { granule_id: cumulusMessage.payload.granules[0].granuleId }
  );
  const fileRecords = await filePgModel.search(knex, { granule_cumulus_id: granuleCumulusId });
  t.is(fileRecords.length, validFileCount);
});

test.serial('writeGranulesFromMessage() stores error on granule if any file fails', async (t) => {
  const {
    collectionCumulusId,
    cumulusMessage,
    executionCumulusId,
    granuleId,
    knex,
    providerCumulusId,
    stepFunctionUtils,
  } = t.context;

  cumulusMessage.meta.status = 'completed';

  const invalidFiles = [
    fakeFileFactory({ bucket: undefined }),
    fakeFileFactory({ bucket: undefined }),
  ];

  const existingFiles = cumulusMessage.payload.granules[0].files;
  cumulusMessage.payload.granules[0].files = existingFiles.concat(invalidFiles);

  const validFiles = 10;
  for (let i = 0; i < validFiles; i += 1) {
    cumulusMessage.payload.granules[0].files.push(fakeFileFactory());
  }

  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    testOverrides: { stepFunctionUtils },
  });

  const pgGranule = await t.context.granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );
  const pgGranuleError = JSON.parse(pgGranule.error.errors);
  t.deepEqual(pgGranuleError.map((error) => error.Error), ['Failed writing files to PostgreSQL.']);
  t.true(pgGranuleError[0].Cause.includes('AggregateError'));
});

test.serial('writeGranulesFromMessage() stores an aggregate workflow error and file-writing error on a granule', async (t) => {
  const {
    collectionCumulusId,
    cumulusMessage,
    executionCumulusId,
    granuleId,
    knex,
    providerCumulusId,
    stepFunctionUtils,
  } = t.context;

  cumulusMessage.meta.status = 'failed';
  cumulusMessage.exception = { Error: 'Unknown error', Cause: { Error: 'Workflow failed' } };
  cumulusMessage.payload.granules[0].files[0].bucket = undefined;
  cumulusMessage.payload.granules[0].files[0].key = undefined;

  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    testOverrides: { stepFunctionUtils },
  });

  const pgGranule = await t.context.granulePgModel.get(knex, {
    granule_id: granuleId,
    collection_cumulus_id: collectionCumulusId,
  });
  t.is(pgGranule.status, 'failed');
  const pgGranuleErrors = JSON.parse(pgGranule.error.errors);
  t.deepEqual(pgGranuleErrors.map((error) => error.Error), ['Unknown error', 'Failed writing files to PostgreSQL.']);
  t.deepEqual(pgGranuleErrors[0].Cause, { Error: 'Workflow failed' });
});

test.serial('writeGranulesFromMessage() honors granule.createdAt time if provided in cumulus_message', async (t) => {
  const {
    collectionCumulusId,
    cumulusMessage,
    executionCumulusId,
    granuleId,
    knex,
    providerCumulusId,
    stepFunctionUtils,
  } = t.context;

  const expectedCreatedAt = Date.now();

  cumulusMessage.payload.granules[0].createdAt = expectedCreatedAt;

  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    testOverrides: { stepFunctionUtils },
  });

  const pgGranule = await t.context.granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );
  t.is(pgGranule.created_at.getTime(), expectedCreatedAt);
});

test.serial('writeGranulesFromMessage() throws if workflow_start_time is not provided on the message', async (t) => {
  const {
    cumulusMessage,
    knex,
    executionCumulusId,
    providerCumulusId,
    stepFunctionUtils,
  } = t.context;

  delete cumulusMessage.cumulus_meta.workflow_start_time;

  await t.throwsAsync(writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    testOverrides: { stepFunctionUtils },
  }), { instanceOf: CumulusMessageError });
});

test.serial('writeGranulesFromMessage() falls back to workflow_start_time if granule.createdAt is not provided in cumulus_message for a granule', async (t) => {
  const {
    collectionCumulusId,
    cumulusMessage,
    executionCumulusId,
    granuleId,
    knex,
    providerCumulusId,
    stepFunctionUtils,
  } = t.context;

  const expectedCreatedAt = 1637017285469;

  // Ensure no createdAt time is provided on the granule
  delete cumulusMessage.payload.granules[0].createdAt;
  cumulusMessage.cumulus_meta.workflow_start_time = expectedCreatedAt;

  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    testOverrides: { stepFunctionUtils },
  });

  const pgGranule = await t.context.granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );
  t.is(pgGranule.created_at.getTime(), expectedCreatedAt);
});

test.serial('writeGranulesFromMessage() sets `published` to false if null value is set', async (t) => {
  const {
    collectionCumulusId,
    cumulusMessage,
    knex,
    executionCumulusId,
    providerCumulusId,
    granuleId,
    stepFunctionUtils,
  } = t.context;

  // Only test fields that are stored in Postgres on the Granule record.
  // The following fields are populated by separate queries during translation
  // or elasticsearch.
  const omitList = ['files', '_id'];

  // Set published to null for test
  cumulusMessage.payload.granules[0].published = null;

  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    testOverrides: { stepFunctionUtils },
  });

  const granulePgRecord = await t.context.granulePgModel.get(
    knex,
    {
      granule_id: granuleId,
      collection_cumulus_id: collectionCumulusId,
    }
  );

  // Validate objects all match
  /// translate the PG granule to API granule to directly compare to ES
  const translatedPgRecord = await translatePostgresGranuleToApiGranule({
    granulePgRecord,
    knexOrTransaction: knex,
  });

  const esRecord = await t.context.esGranulesClient.get(granuleId);
  t.deepEqual(omit(translatedPgRecord, omitList), omit(esRecord, omitList));

  // Validate assertion is true in the primary datastore:

  t.is(translatedPgRecord.published, false);
});

test.serial('writeGranulesFromMessage() does not write a granule to Postgres or ES if a granule with the same ID and with a different collection ID already exists', async (t) => {
  const {
    collectionPgModel,
    collectionCumulusId,
    cumulusMessage,
    executionCumulusId,
    granuleId,
    granulePgModel,
    knex,
    providerCumulusId,
    stepFunctionUtils,
  } = t.context;

  const differentCollection = fakeCollectionRecordFactory();
  const [pgCollection] = await collectionPgModel.create(
    knex,
    differentCollection
  );

  const [pgGranule] = await granulePgModel.create(
    knex,
    fakeGranuleRecordFactory({
      granule_id: granuleId,
      collection_cumulus_id: pgCollection.cumulus_id,
    }),
    '*'
  );

  const [error] = await t.throwsAsync(writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    granulePgModel,
    testOverrides: { stepFunctionUtils },
  }));

  t.true(error.message.includes(`A granule already exists for granuleId: ${pgGranule.granule_id}`));
  t.false(
    await t.context.granulePgModel.exists(knex, {
      granule_id: granuleId,
      collection_cumulus_id: collectionCumulusId,
    })
  );
  t.false(await t.context.esGranulesClient.exists(granuleId));

  const { Messages } = await sqs().receiveMessage({
    QueueUrl: t.context.QueueUrl,
    WaitTimeSeconds: 10,
  }).promise();
  t.is(Messages, undefined);
});

test.serial('writeGranulesFromMessage() does not persist file records to Postgres if the workflow status is "running"', async (t) => {
  // files not persisted due to writeConstraints
  const {
    collectionCumulusId,
    cumulusMessage,
    executionCumulusId,
    filePgModel,
    granuleId,
    granulePgModel,
    knex,
    providerCumulusId,
    stepFunctionUtils,
  } = t.context;

  cumulusMessage.meta.status = 'running';

  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    testOverrides: { stepFunctionUtils },
  });

  const granule = await granulePgModel.get(
    knex,
    {
      granule_id: granuleId,
      collection_cumulus_id: collectionCumulusId,
    }
  );

  t.false(
    await filePgModel.exists(knex, { granule_cumulus_id: granule.cumulus_id })
  );
});

test.serial('writeGranulesFromMessage() does not persist file records to Postgres if the workflow status is "queued"', async (t) => {
  // files not persisted due to writeConstraints
  const {
    collectionCumulusId,
    cumulusMessage,
    executionCumulusId,
    filePgModel,
    granuleId,
    granulePgModel,
    knex,
    providerCumulusId,
    stepFunctionUtils,
  } = t.context;

  cumulusMessage.meta.status = 'queued';

  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    testOverrides: { stepFunctionUtils },
  });

  const granule = await granulePgModel.get(
    knex,
    {
      granule_id: granuleId,
      collection_cumulus_id: collectionCumulusId,
    }
  );

  t.false(
    await filePgModel.exists(knex, { granule_cumulus_id: granule.cumulus_id })
  );
});

test.serial('writeGranulesFromMessage() on re-write with the same granule values and files with "completed" status saves granule records to PostgreSQL/Elasticsearch with updated product volume, expected values, and files', async (t) => {
  // a re-write with same values and files accomplishes the same result
  // as an update with different values
  // for completed status, whether the re-write is with the same execution or a new one
  // does not make a difference
  const {
    collection,
    collectionCumulusId,
    cumulusMessage,
    esGranulesClient,
    executionCumulusId,
    executionUrl,
    files,
    granulePgModel,
    knex,
    providerCumulusId,
    stepFunctionUtils,
  } = t.context;

  const completeGranule = fakeGranuleFactoryV2({
    collectionId: constructCollectionId(collection.name, collection.version),
    execution: executionUrl,
    files: files,
    status: 'completed',
  });

  const granuleId = completeGranule.granuleId;
  cumulusMessage.meta.status = 'completed';
  cumulusMessage.payload.granules[0] = completeGranule;

  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    testOverrides: { stepFunctionUtils },
  });

  t.true(
    await granulePgModel.exists(knex, {
      granule_id: completeGranule.granuleId,
      collection_cumulus_id: collectionCumulusId,
    })
  );
  t.true(await esGranulesClient.exists(completeGranule.granuleId));

  const initialPostgresRecord = await granulePgModel.get(knex, {
    granule_id: granuleId,
    collection_cumulus_id: collectionCumulusId,
  });
  const apiFormattedInitialPostgresGranule =
    await translatePostgresGranuleToApiGranule({
      granulePgRecord: initialPostgresRecord,
      knexOrTransaction: knex,
    });

  cumulusMessage.payload.granules[0] = apiFormattedInitialPostgresGranule;
  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    testOverrides: { stepFunctionUtils },
  });

  const postgresRecord = await granulePgModel.get(knex, {
    granule_id: granuleId,
    collection_cumulus_id: collectionCumulusId,
  });
  const apiFormattedPostgresGranule
    = await translatePostgresGranuleToApiGranule({
      granulePgRecord: postgresRecord,
      knexOrTransaction: knex,
    });
  const esRecord = await esGranulesClient.get(granuleId);

  const expectedGranule = {
    ...apiFormattedInitialPostgresGranule,
    // should already be part of apiFormattedInitialPostgresGranule
    // but setting more explicitly for test transparency
    files: files,
    // These values *must* be set or the message write logic sets them.
    createdAt: apiFormattedPostgresGranule.createdAt,
    published: true,
    timestamp: apiFormattedPostgresGranule.timestamp,
    updatedAt: apiFormattedPostgresGranule.updatedAt,
    // Values to be set as they're set by default for all writes (based on message info)
    // productVolume is also calculated based on payload
    duration: apiFormattedPostgresGranule.duration,
    error: {},
    pdrName: cumulusMessage.payload.pdr.name,
    productVolume: String(
      cumulusMessage.payload.granules[0].files.reduce(
        (pv, cv) => cv.size + pv,
        0
      )
    ),
    status: cumulusMessage.meta.status,
    // These values are set *only* via finder methods in the message, and override
    // the passed in granule value.   The factory leaves these unset, so they default to zero
    timeToArchive: 0,
    timeToPreprocess: 0,
  };

  // Files array order is not promised to match between datastores
  [esRecord, expectedGranule, apiFormattedPostgresGranule].forEach((record) => {
    record.files.sort((f1, f2) => sortFilesByBuckets(f1, f2));
  });

  // Translated postgres granule matches expected updatedGranule
  // minus model defaults
  t.deepEqual(
    apiFormattedPostgresGranule,
    removeNilProperties(expectedGranule)
  );
  t.deepEqual(omit(esRecord, ['_id']), removeNilProperties(expectedGranule));
});

test.serial('writeGranulesFromMessage() on re-write with the same granule values but different files with "completed" status saves granule records to PostgreSQL/Elasticsearch with updated product volume, expected values, and replaces the files', async (t) => {
  // a re-write with same values and files accomplishes the same result
  // as an update with different values
  // for completed status, whether the re-write is with the same execution or a new one
  // does not make a difference
  const {
    collection,
    collectionCumulusId,
    cumulusMessage,
    esGranulesClient,
    executionCumulusId,
    executionUrl,
    files,
    granulePgModel,
    knex,
    providerCumulusId,
    stepFunctionUtils,
  } = t.context;

  const completeGranule = fakeGranuleFactoryV2({
    collectionId: constructCollectionId(collection.name, collection.version),
    execution: executionUrl,
    files: files,
    status: 'completed',
  });

  const granuleId = completeGranule.granuleId;
  cumulusMessage.meta.status = 'completed';
  cumulusMessage.payload.granules[0] = completeGranule;

  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    testOverrides: { stepFunctionUtils },
  });

  t.true(
    await granulePgModel.exists(knex, {
      granule_id: completeGranule.granuleId,
      collection_cumulus_id: collectionCumulusId,
    })
  );
  t.true(await esGranulesClient.exists(completeGranule.granuleId));

  // Create new files for granule. These records will exist in database
  // during subsequent granule write from message
  const updatedFiles = [
    fakeFileFactory({ size: 5 }),
    fakeFileFactory({ size: 10 }),
    fakeFileFactory({ size: 15 }),
    fakeFileFactory({ size: 20 }),
  ];

  const updatedGranule = {
    ...completeGranule,
    files: updatedFiles,
    status: 'completed',
  };
  cumulusMessage.meta.status = 'completed';
  cumulusMessage.payload.granules[0] = updatedGranule;
  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    testOverrides: { stepFunctionUtils },
  });

  const postgresRecord = await granulePgModel.get(knex, {
    granule_id: granuleId,
    collection_cumulus_id: collectionCumulusId,
  });
  const apiFormattedPostgresGranule
    = await translatePostgresGranuleToApiGranule({
      granulePgRecord: postgresRecord,
      knexOrTransaction: knex,
    });
  const esRecord = await esGranulesClient.get(granuleId);

  const expectedGranule = {
    ...updatedGranule,
    // should already be part of updatedGranule, but setting here more explicity
    files: updatedFiles,
    // These values *must* be set or the message write logic sets them.
    createdAt: apiFormattedPostgresGranule.createdAt,
    published: true,
    timestamp: apiFormattedPostgresGranule.timestamp,
    updatedAt: apiFormattedPostgresGranule.updatedAt,
    // Values to be set as they're set by default for all writes (based on message info)
    // productVolume is also calculated based on payload
    duration: apiFormattedPostgresGranule.duration,
    error: {},
    pdrName: cumulusMessage.payload.pdr.name,
    productVolume: '50',
    status: cumulusMessage.meta.status,
    // These values are set *only* via finder methods in the message, and override
    // the passed in granule value.   The factory leaves these unset, so they default to zero
    timeToArchive: 0,
    timeToPreprocess: 0,
  };

  // Files array order is not promised to match between datastores
  [esRecord, expectedGranule, apiFormattedPostgresGranule].forEach((record) => {
    record.files.sort((f1, f2) => sortFilesByBuckets(f1, f2));
  });

  // Translated postgres granule matches expected updatedGranule
  // minus model defaults
  t.deepEqual(
    apiFormattedPostgresGranule,
    removeNilProperties(expectedGranule)
  );
  t.deepEqual(omit(esRecord, ['_id']), removeNilProperties(expectedGranule));
});

test.serial('writeGranulesFromMessage() on update changing granule status to "running", with different files and the same execution, does not update the granule values or files in Postgres/ES, so the pre-existing values and files will persist', async (t) => {
  // a re-write with same values and files accomplishes the same result
  // as an update with different values
  // for running status, there is a difference whether the re-write is with the same execution
  // or a new one
  const {
    collection,
    collectionCumulusId,
    cumulusMessage,
    esGranulesClient,
    executionCumulusId,
    files,
    granulePgModel,
    knex,
    providerCumulusId,
    stepFunctionUtils,
  } = t.context;

  const completeGranule = fakeGranuleFactoryV2({
    collectionId: constructCollectionId(collection.name, collection.version),
    files: files,
    status: 'completed',
  });

  const granuleId = completeGranule.granuleId;
  cumulusMessage.meta.status = 'completed';
  cumulusMessage.payload.granules[0] = completeGranule;

  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    testOverrides: { stepFunctionUtils },
  });

  t.true(
    await granulePgModel.exists(knex, {
      granule_id: completeGranule.granuleId,
      collection_cumulus_id: collectionCumulusId,
    })
  );
  t.true(await esGranulesClient.exists(completeGranule.granuleId));

  const initialPostgresRecord = await granulePgModel.get(knex, {
    granule_id: granuleId,
    collection_cumulus_id: collectionCumulusId,
  });
  const apiFormattedInitialPostgresGranule =
    await translatePostgresGranuleToApiGranule({
      granulePgRecord: initialPostgresRecord,
      knexOrTransaction: knex,
    });

  // Create new files for granule that will not update. These records will exist in database
  // during subsequent granule write from message
  const failUpdateFiles = [
    fakeFileFactory({ size: 5 }),
    fakeFileFactory({ size: 10 }),
    fakeFileFactory({ size: 15 }),
    fakeFileFactory({ size: 20 }),
  ];

  const failUpdateGranule = {
    ...completeGranule,
    files: failUpdateFiles,
    status: 'running',
    cmrLink: 'updatedGranuled.com',
  };
  cumulusMessage.meta.status = 'running';
  cumulusMessage.payload.granules[0] = failUpdateGranule;

  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    testOverrides: { stepFunctionUtils },
  });

  const postgresRecord = await granulePgModel.get(knex, {
    granule_id: granuleId,
    collection_cumulus_id: collectionCumulusId,
  });
  const apiFormattedPostgresGranule
    = await translatePostgresGranuleToApiGranule({
      granulePgRecord: postgresRecord,
      knexOrTransaction: knex,
    });
  const esRecord = await esGranulesClient.get(granuleId);

  const expectedGranule = {
    ...apiFormattedInitialPostgresGranule,
    // should already be part of apiFormattedInitialPostgresGranule
    // but setting more explicitly for test transparency
    // these values and files were not changed so have values from the first write
    files: files,
    status: 'completed',
    cmrLink: 'example.com',
    productVolume: '15',
    createdAt: apiFormattedInitialPostgresGranule.createdAt,
    timestamp: apiFormattedInitialPostgresGranule.timestamp,
    updatedAt: apiFormattedInitialPostgresGranule.updatedAt,
  };

  // Files array order is not promised to match between datastores
  [esRecord, expectedGranule, apiFormattedPostgresGranule].forEach((record) => {
    record.files.sort((f1, f2) => sortFilesByBuckets(f1, f2));
  });

  // Translated postgres granule matches expected updatedGranule
  // minus model defaults
  t.deepEqual(
    apiFormattedPostgresGranule,
    removeNilProperties(expectedGranule)
  );
  t.deepEqual(omit(esRecord, ['_id']), removeNilProperties(expectedGranule));
});

test.serial('writeGranulesFromMessage() on update changing granule status to "queued", with different files and the same execution, does not update the granule values or files in Postgres/ES, so the pre-existing values and files will persist', async (t) => {
  // a re-write with same values and files accomplishes the same result
  // as an update with different values
  // for queued status, there is a difference whether the re-write is with the same execution
  // or a new one
  const {
    collection,
    collectionCumulusId,
    cumulusMessage,
    esGranulesClient,
    executionCumulusId,
    files,
    granulePgModel,
    knex,
    providerCumulusId,
    stepFunctionUtils,
  } = t.context;

  const completeGranule = fakeGranuleFactoryV2({
    collectionId: constructCollectionId(collection.name, collection.version),
    files: files,
    status: 'completed',
  });

  const granuleId = completeGranule.granuleId;
  cumulusMessage.meta.status = 'completed';
  cumulusMessage.payload.granules[0] = completeGranule;

  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    testOverrides: { stepFunctionUtils },
  });

  t.true(
    await granulePgModel.exists(knex, {
      granule_id: completeGranule.granuleId,
      collection_cumulus_id: collectionCumulusId,
    })
  );
  t.true(await esGranulesClient.exists(completeGranule.granuleId));

  const initialPostgresRecord = await granulePgModel.get(knex, {
    granule_id: granuleId,
    collection_cumulus_id: collectionCumulusId,
  });
  const apiFormattedInitialPostgresGranule =
    await translatePostgresGranuleToApiGranule({
      granulePgRecord: initialPostgresRecord,
      knexOrTransaction: knex,
    });

  // Create new files for granule that will not update. These records will exist in database
  // during subsequent granule write from message
  const failUpdateFiles = [
    fakeFileFactory({ size: 5 }),
    fakeFileFactory({ size: 10 }),
    fakeFileFactory({ size: 15 }),
    fakeFileFactory({ size: 20 }),
  ];

  const failUpdateGranule = {
    ...completeGranule,
    files: failUpdateFiles,
    status: 'queued',
    cmrLink: 'updatedGranuled.com',
  };
  cumulusMessage.meta.status = 'queued';
  cumulusMessage.payload.granules[0] = failUpdateGranule;

  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    testOverrides: { stepFunctionUtils },
  });

  const postgresRecord = await granulePgModel.get(knex, {
    granule_id: granuleId,
    collection_cumulus_id: collectionCumulusId,
  });
  const apiFormattedPostgresGranule
    = await translatePostgresGranuleToApiGranule({
      granulePgRecord: postgresRecord,
      knexOrTransaction: knex,
    });
  const esRecord = await esGranulesClient.get(granuleId);

  const expectedGranule = {
    ...apiFormattedInitialPostgresGranule,
    // should already be part of apiFormattedInitialPostgresGranule
    // but setting more explicitly for test transparency
    // these values and files were not changed so have values from the first write
    files: files,
    status: 'completed',
    cmrLink: 'example.com',
    productVolume: '15',
    createdAt: apiFormattedInitialPostgresGranule.createdAt,
    timestamp: apiFormattedInitialPostgresGranule.timestamp,
    updatedAt: apiFormattedInitialPostgresGranule.updatedAt,
  };

  // Files array order is not promised to match between datastores
  [esRecord, expectedGranule, apiFormattedPostgresGranule].forEach((record) => {
    record.files.sort((f1, f2) => sortFilesByBuckets(f1, f2));
  });

  // Translated postgres granule matches expected updatedGranule
  // minus model defaults
  t.deepEqual(
    apiFormattedPostgresGranule,
    removeNilProperties(expectedGranule)
  );
  t.deepEqual(omit(esRecord, ['_id']), removeNilProperties(expectedGranule));
});

test.serial('writeGranulesFromMessage() on update changing granule status to "running", with different files and a new execution, updates only limited granule values to Postgres/ES, and does not persist updates to the files', async (t) => {
  // a re-write with same values accomplishes the same result as an update with different values
  // for running status, there is a difference whether the re-write is with the same execution
  // or a new one
  const {
    collection,
    collectionCumulusId,
    cumulusMessage,
    esGranulesClient,
    executionCumulusId,
    files,
    granulePgModel,
    knex,
    providerCumulusId,
    stepFunctionUtils,
  } = t.context;

  const completeGranule = fakeGranuleFactoryV2({
    collectionId: constructCollectionId(collection.name, collection.version),
    files: files,
    status: 'completed',
  });

  const granuleId = completeGranule.granuleId;
  cumulusMessage.meta.status = 'completed';
  cumulusMessage.payload.granules[0] = completeGranule;

  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    testOverrides: { stepFunctionUtils },
  });

  t.true(
    await granulePgModel.exists(knex, {
      granule_id: completeGranule.granuleId,
      collection_cumulus_id: collectionCumulusId,
    })
  );
  t.true(await esGranulesClient.exists(completeGranule.granuleId));

  const initialPostgresRecord = await granulePgModel.get(knex, {
    granule_id: granuleId,
    collection_cumulus_id: collectionCumulusId,
  });
  const apiFormattedInitialPostgresGranule =
    await translatePostgresGranuleToApiGranule({
      granulePgRecord: initialPostgresRecord,
      knexOrTransaction: knex,
    });

  // Create new files for granule that will not update. These records will exist in database
  // during subsequent granule write from message
  const failUpdateFiles = [
    fakeFileFactory({ size: 5 }),
    fakeFileFactory({ size: 10 }),
    fakeFileFactory({ size: 15 }),
    fakeFileFactory({ size: 20 }),
  ];

  // set new createdAt and start time
  const newCreatedAt = Date.now();
  const partialUpdateGranule = {
    ...completeGranule,
    files: failUpdateFiles,
    cmrLink: 'updatedGranuled.com',
    status: 'running',
    createdAt: newCreatedAt,
  };

  // create a new execution for the granule update operation
  const { executionName, pgExecution, executionUrl } = await createGranuleExecution(t, 'running', t.context.stateMachineName);

  cumulusMessage.cumulus_meta.workflow_start_time = newCreatedAt;
  cumulusMessage.meta.status = 'running';
  cumulusMessage.cumulus_meta.execution_name = executionName;
  cumulusMessage.payload.granules[0] = partialUpdateGranule;

  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId: pgExecution.cumulus_id,
    providerCumulusId,
    knex,
    testOverrides: { stepFunctionUtils },
  });

  const postgresRecord = await granulePgModel.get(knex, {
    granule_id: granuleId,
    collection_cumulus_id: collectionCumulusId,
  });
  const apiFormattedPostgresGranule
    = await translatePostgresGranuleToApiGranule({
      granulePgRecord: postgresRecord,
      knexOrTransaction: knex,
    });
  const esRecord = await esGranulesClient.get(granuleId);

  const expectedGranule = {
    ...apiFormattedInitialPostgresGranule,
    // these original values should already be part of apiFormattedInitialPostgresGranule as they
    // were not updated but setting more explicitly for test transparency
    files: files,
    cmrLink: 'example.com',
    productVolume: '15',
    duration: apiFormattedInitialPostgresGranule.duration,
    // these are the only values that are updated in the granule
    // some of the timestamp values are based on the operation
    status: 'running',
    createdAt: newCreatedAt,
    timestamp: apiFormattedPostgresGranule.timestamp,
    updatedAt: apiFormattedPostgresGranule.updatedAt,
    // these values are updated due to the new execution
    execution: executionUrl,
  };

  // Files array order is not promised to match between datastores
  [esRecord, expectedGranule, apiFormattedPostgresGranule].forEach((record) => {
    record.files.sort((f1, f2) => sortFilesByBuckets(f1, f2));
  });

  // Translated postgres granule matches expected updatedGranule
  // minus model defaults
  t.deepEqual(
    apiFormattedPostgresGranule,
    removeNilProperties(expectedGranule)
  );
  t.deepEqual(omit(esRecord, ['_id']), removeNilProperties(expectedGranule));
});

test.serial('writeGranulesFromMessage() on update changing granule status to "queued", with different files and a new execution, does not update the granule values or files in Postgres/ES, so the pre-existing values and files will persist', async (t) => {
  // a re-write with same values accomplishes the same result as an update with different values
  // for queued status, there is a difference whether the re-write is with the same execution
  // or a new one, but only between an existing execution and a non-existing execution
  const {
    collection,
    collectionCumulusId,
    cumulusMessage,
    esGranulesClient,
    executionCumulusId,
    files,
    granulePgModel,
    knex,
    providerCumulusId,
    stepFunctionUtils,
  } = t.context;

  const completeGranule = fakeGranuleFactoryV2({
    collectionId: constructCollectionId(collection.name, collection.version),
    files: files,
    status: 'completed',
  });

  const granuleId = completeGranule.granuleId;
  cumulusMessage.meta.status = 'completed';
  cumulusMessage.payload.granules[0] = completeGranule;

  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    testOverrides: { stepFunctionUtils },
  });

  t.true(
    await granulePgModel.exists(knex, {
      granule_id: completeGranule.granuleId,
      collection_cumulus_id: collectionCumulusId,
    })
  );
  t.true(await esGranulesClient.exists(completeGranule.granuleId));

  const initialPostgresRecord = await granulePgModel.get(knex, {
    granule_id: granuleId,
    collection_cumulus_id: collectionCumulusId,
  });
  const apiFormattedInitialPostgresGranule =
    await translatePostgresGranuleToApiGranule({
      granulePgRecord: initialPostgresRecord,
      knexOrTransaction: knex,
    });

  // Create new files for granule that will not update. These records will exist in database
  // during subsequent granule write from message
  const failUpdateFiles = [
    fakeFileFactory({ size: 5 }),
    fakeFileFactory({ size: 10 }),
    fakeFileFactory({ size: 15 }),
    fakeFileFactory({ size: 20 }),
  ];

  // set new createdAt and start time
  const newCreatedAt = Date.now();
  const partialUpdateGranule = {
    ...completeGranule,
    files: failUpdateFiles,
    cmrLink: 'updatedGranuled.com',
    status: 'queued',
    createdAt: newCreatedAt,
  };

  // create a new execution for the granule update operation
  const { executionName, pgExecution } = await createGranuleExecution(t, 'running', t.context.stateMachineName);

  cumulusMessage.cumulus_meta.workflow_start_time = newCreatedAt;
  cumulusMessage.meta.status = 'queued';
  cumulusMessage.cumulus_meta.execution_name = executionName;
  cumulusMessage.payload.granules[0] = partialUpdateGranule;

  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId: pgExecution.cumulus_id,
    providerCumulusId,
    knex,
    testOverrides: { stepFunctionUtils },
  });

  const postgresRecord = await granulePgModel.get(knex, {
    granule_id: granuleId,
    collection_cumulus_id: collectionCumulusId,
  });
  const apiFormattedPostgresGranule
    = await translatePostgresGranuleToApiGranule({
      granulePgRecord: postgresRecord,
      knexOrTransaction: knex,
    });
  const esRecord = await esGranulesClient.get(granuleId);

  const expectedGranule = {
    ...apiFormattedInitialPostgresGranule,
    // should already be part of apiFormattedInitialPostgresGranule
    // but setting more explicitly for test transparency
    // these values and files were not changed so have values from the first write
    files: files,
    status: 'completed',
    cmrLink: 'example.com',
    productVolume: '15',
    createdAt: apiFormattedInitialPostgresGranule.createdAt,
    timestamp: apiFormattedInitialPostgresGranule.timestamp,
    updatedAt: apiFormattedInitialPostgresGranule.updatedAt,
  };

  // Files array order is not promised to match between datastores
  [esRecord, expectedGranule, apiFormattedPostgresGranule].forEach((record) => {
    record.files.sort((f1, f2) => sortFilesByBuckets(f1, f2));
  });

  // Translated postgres granule matches expected updatedGranule
  // minus model defaults
  t.deepEqual(
    apiFormattedPostgresGranule,
    removeNilProperties(expectedGranule)
  );
  t.deepEqual(omit(esRecord, ['_id']), removeNilProperties(expectedGranule));
});

test.serial('writeGranulesFromMessage() on update changing granule status to "running", with different files, a new execution, and a stale granule createdAt, does not update the granule values or files in Postgres/ES or to the files, so the pre-existing values and files will persist', async (t) => {
  // for running status, there is a difference whether the re-write is with the same execution
  // or a new one
  const {
    collection,
    collectionCumulusId,
    cumulusMessage,
    esGranulesClient,
    executionCumulusId,
    files,
    granulePgModel,
    knex,
    providerCumulusId,
    stepFunctionUtils,
  } = t.context;

  const completeGranule = fakeGranuleFactoryV2({
    collectionId: constructCollectionId(collection.name, collection.version),
    files: files,
    status: 'completed',
  });

  const granuleId = completeGranule.granuleId;
  cumulusMessage.meta.status = 'completed';
  cumulusMessage.payload.granules[0] = completeGranule;

  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    testOverrides: { stepFunctionUtils },
  });

  t.true(
    await granulePgModel.exists(knex, {
      granule_id: completeGranule.granuleId,
      collection_cumulus_id: collectionCumulusId,
    })
  );
  t.true(await esGranulesClient.exists(completeGranule.granuleId));

  const initialPostgresRecord = await granulePgModel.get(knex, {
    granule_id: granuleId,
    collection_cumulus_id: collectionCumulusId,
  });
  const apiFormattedInitialPostgresGranule =
    await translatePostgresGranuleToApiGranule({
      granulePgRecord: initialPostgresRecord,
      knexOrTransaction: knex,
    });

  // Create new files for stale granule. These records will exist in database
  // during subsequent granule write from message
  const staleUpdateFiles = [
    fakeFileFactory({ size: 5 }),
    fakeFileFactory({ size: 10 }),
    fakeFileFactory({ size: 15 }),
    fakeFileFactory({ size: 20 }),
  ];
  // set up stale createdAt date
  const staleCreatedAt = Date.now() - 24 * 60 * 60 * 1000;
  // setup stale granule for update with 'running' status, which should run into writeConstraints
  const staleUpdateGranule = {
    ...completeGranule,
    files: staleUpdateFiles,
    status: 'running',
    cmrLink: 'updatedGranuled.com',
    createdAt: staleCreatedAt,
  };

  // create a new execution for the granule update operation
  const { executionName, pgExecution } = await createGranuleExecution(t, 'running', t.context.stateMachineName);

  cumulusMessage.meta.status = 'running';
  cumulusMessage.cumulus_meta.execution_name = executionName;
  cumulusMessage.payload.granules[0] = staleUpdateGranule;

  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId: pgExecution.cumulus_id,
    providerCumulusId,
    knex,
    testOverrides: { stepFunctionUtils },
  });

  const postgresRecord = await granulePgModel.get(knex, {
    granule_id: granuleId,
    collection_cumulus_id: collectionCumulusId,
  });
  const apiFormattedPostgresGranule
    = await translatePostgresGranuleToApiGranule({
      granulePgRecord: postgresRecord,
      knexOrTransaction: knex,
    });
  const esRecord = await esGranulesClient.get(granuleId);

  const expectedGranule = {
    ...apiFormattedInitialPostgresGranule,
    // should already be part of apiFormattedInitialPostgresGranule
    // but setting more explicitly for test transparency
    // these values and files were not changed so have values from the first write
    files: files,
    status: 'completed',
    cmrLink: 'example.com',
    productVolume: '15',
    createdAt: apiFormattedInitialPostgresGranule.createdAt,
    timestamp: apiFormattedInitialPostgresGranule.timestamp,
    updatedAt: apiFormattedInitialPostgresGranule.updatedAt,
  };

  // Files array order is not promised to match between datastores
  [esRecord, expectedGranule, apiFormattedPostgresGranule].forEach((record) => {
    record.files.sort((f1, f2) => sortFilesByBuckets(f1, f2));
  });

  // Translated postgres granule matches expected updatedGranule
  // minus model defaults
  t.deepEqual(
    apiFormattedPostgresGranule,
    removeNilProperties(expectedGranule)
  );
  t.deepEqual(omit(esRecord, ['_id']), removeNilProperties(expectedGranule));
});

test.serial('writeGranulesFromMessage() on update changing granule status to "queued", with different files, a new execution, and a stale granule createdAt, does not update the granule values or files in Postgres/ES or to the files, so the pre-existing values and files will persist', async (t) => {
  // for queued status, there is a difference whether the re-write is with the same execution
  // or a new one
  const {
    collection,
    collectionCumulusId,
    cumulusMessage,
    esGranulesClient,
    executionCumulusId,
    files,
    granulePgModel,
    knex,
    providerCumulusId,
    stepFunctionUtils,
  } = t.context;

  const completeGranule = fakeGranuleFactoryV2({
    collectionId: constructCollectionId(collection.name, collection.version),
    files: files,
    status: 'completed',
  });

  const granuleId = completeGranule.granuleId;
  cumulusMessage.meta.status = 'completed';
  cumulusMessage.payload.granules[0] = completeGranule;

  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    testOverrides: { stepFunctionUtils },
  });

  t.true(
    await granulePgModel.exists(knex, {
      granule_id: completeGranule.granuleId,
      collection_cumulus_id: collectionCumulusId,
    })
  );
  t.true(await esGranulesClient.exists(completeGranule.granuleId));

  const initialPostgresRecord = await granulePgModel.get(knex, {
    granule_id: granuleId,
    collection_cumulus_id: collectionCumulusId,
  });
  const apiFormattedInitialPostgresGranule =
    await translatePostgresGranuleToApiGranule({
      granulePgRecord: initialPostgresRecord,
      knexOrTransaction: knex,
    });

  // Create new files for stale granule. These records will exist in database
  // during subsequent granule write from message
  const staleUpdateFiles = [
    fakeFileFactory({ size: 5 }),
    fakeFileFactory({ size: 10 }),
    fakeFileFactory({ size: 15 }),
    fakeFileFactory({ size: 20 }),
  ];
  // set up stale createdAt date
  const staleCreatedAt = Date.now() - 24 * 60 * 60 * 1000;
  // setup stale granule for update with 'running' status, which should run into writeConstraints
  const staleUpdateGranule = {
    ...completeGranule,
    files: staleUpdateFiles,
    status: 'queued',
    cmrLink: 'updatedGranuled.com',
    createdAt: staleCreatedAt,
  };

  // create a new execution for the granule update operation
  const { executionName, pgExecution } = await createGranuleExecution(t, 'running', t.context.stateMachineName);

  cumulusMessage.meta.status = 'queued';
  cumulusMessage.cumulus_meta.execution_name = executionName;
  cumulusMessage.payload.granules[0] = staleUpdateGranule;

  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId: pgExecution.cumulus_id,
    providerCumulusId,
    knex,
    testOverrides: { stepFunctionUtils },
  });

  const postgresRecord = await granulePgModel.get(knex, {
    granule_id: granuleId,
    collection_cumulus_id: collectionCumulusId,
  });
  const apiFormattedPostgresGranule
    = await translatePostgresGranuleToApiGranule({
      granulePgRecord: postgresRecord,
      knexOrTransaction: knex,
    });
  const esRecord = await esGranulesClient.get(granuleId);

  const expectedGranule = {
    ...apiFormattedInitialPostgresGranule,
    // should already be part of apiFormattedInitialPostgresGranule
    // but setting more explicitly for test transparency
    // these values and files were not changed so have values from the first write
    files: files,
    status: 'completed',
    cmrLink: 'example.com',
    productVolume: '15',
    createdAt: apiFormattedInitialPostgresGranule.createdAt,
    timestamp: apiFormattedInitialPostgresGranule.timestamp,
    updatedAt: apiFormattedInitialPostgresGranule.updatedAt,
  };

  // Files array order is not promised to match between datastores
  [esRecord, expectedGranule, apiFormattedPostgresGranule].forEach((record) => {
    record.files.sort((f1, f2) => sortFilesByBuckets(f1, f2));
  });

  // Translated postgres granule matches expected updatedGranule
  // minus model defaults
  t.deepEqual(
    apiFormattedPostgresGranule,
    removeNilProperties(expectedGranule)
  );
  t.deepEqual(omit(esRecord, ['_id']), removeNilProperties(expectedGranule));
});

test.serial('writeGranulesFromMessage() on update with "completed" status and stale granule createdAt, does not persist the granule updates to Postgres/ES or to the files', async (t) => {
  // for completed status, whether the update is with the same execution or a new one
  // does not make a difference
  const {
    collection,
    collectionCumulusId,
    cumulusMessage,
    esGranulesClient,
    executionCumulusId,
    files,
    granulePgModel,
    knex,
    providerCumulusId,
    stepFunctionUtils,
  } = t.context;

  const completeGranule = fakeGranuleFactoryV2({
    collectionId: constructCollectionId(collection.name, collection.version),
    files: files,
    status: 'completed',
  });

  const granuleId = completeGranule.granuleId;
  cumulusMessage.meta.status = 'completed';
  cumulusMessage.payload.granules[0] = completeGranule;

  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    testOverrides: { stepFunctionUtils },
  });

  t.true(
    await granulePgModel.exists(knex, {
      granule_id: completeGranule.granuleId,
      collection_cumulus_id: collectionCumulusId,
    })
  );
  t.true(await esGranulesClient.exists(completeGranule.granuleId));

  const initialPostgresRecord = await granulePgModel.get(knex, {
    granule_id: granuleId,
    collection_cumulus_id: collectionCumulusId,
  });
  const apiFormattedInitialPostgresGranule =
    await translatePostgresGranuleToApiGranule({
      granulePgRecord: initialPostgresRecord,
      knexOrTransaction: knex,
    });

  // Create new files for stale granule. These records will exist in database
  // during subsequent granule write from message
  const staleUpdateFiles = [
    fakeFileFactory({ size: 5 }),
    fakeFileFactory({ size: 10 }),
    fakeFileFactory({ size: 15 }),
    fakeFileFactory({ size: 20 }),
  ];
  // set up stale createdAt date
  const staleCreatedAt = Date.now() - 24 * 60 * 60 * 1000;
  // setup stale granule for update with 'completed' status, should avoid writeConstraints
  const staleUpdateGranule = {
    ...completeGranule,
    files: staleUpdateFiles,
    createdAt: staleCreatedAt,
    status: 'completed',
    cmrLink: 'updatedGranuled.com',
  };
  cumulusMessage.meta.status = 'completed';
  cumulusMessage.payload.granules[0] = staleUpdateGranule;

  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    testOverrides: { stepFunctionUtils },
  });

  const postgresRecord = await granulePgModel.get(knex, {
    granule_id: granuleId,
    collection_cumulus_id: collectionCumulusId,
  });
  const apiFormattedPostgresGranule
    = await translatePostgresGranuleToApiGranule({
      granulePgRecord: postgresRecord,
      knexOrTransaction: knex,
    });
  const esRecord = await esGranulesClient.get(granuleId);

  const expectedGranule = {
    ...apiFormattedInitialPostgresGranule,
    // should already be part of apiFormattedInitialPostgresGranule
    // but setting more explicitly for test transparency
    // these values and files were not changed so have values from the first write
    files: files,
    status: 'completed',
    cmrLink: 'example.com',
    productVolume: '15',
    createdAt: apiFormattedInitialPostgresGranule.createdAt,
    timestamp: apiFormattedInitialPostgresGranule.timestamp,
    updatedAt: apiFormattedInitialPostgresGranule.updatedAt,
  };

  // Files array order is not promised to match between datastores
  [esRecord, expectedGranule, apiFormattedPostgresGranule].forEach((record) => {
    record.files.sort((f1, f2) => sortFilesByBuckets(f1, f2));
  });

  // Translated postgres granule matches expected updatedGranule
  // minus model defaults
  t.deepEqual(
    apiFormattedPostgresGranule,
    removeNilProperties(expectedGranule)
  );
  t.deepEqual(omit(esRecord, ['_id']), removeNilProperties(expectedGranule));
});

test.serial('writeGranuleFromApi() removes preexisting granule file from postgres on granule update with disjoint files', async (t) => {
  const {
    collectionCumulusId,
    esClient,
    filePgModel,
    granule,
    granuleId,
    granulePgModel,
    knex,
  } = t.context;

  const snsEventType = 'Create';
  const pgGranule = await translateApiGranuleToPostgresGranule({
    dynamoRecord: granule,
    knexOrTransaction: knex,
  });
  const returnedGranule = await granulePgModel.create(knex, pgGranule, '*');

  const [fakeFile] = await filePgModel.create(knex, {
    granule_cumulus_id: returnedGranule[0].cumulus_id,
    bucket: 'fake_bucket',
    key: 'fake_key',
  }, '*');

  await writeGranuleFromApi({ ...granule, status: 'completed' }, knex, esClient, snsEventType);

  const granuleRecord = await granulePgModel.get(
    knex,
    {
      granule_id: granuleId,
      collection_cumulus_id: collectionCumulusId,
    }
  );

  const granuleFiles = await filePgModel.search(knex, {
    granule_cumulus_id: granuleRecord.cumulus_id,
  });
  t.deepEqual(granuleFiles.filter((file) => file.bucket === fakeFile.bucket), []);
});

test.serial('writeGranuleFromApi() throws for a granule with no granuleId provided', async (t) => {
  const {
    knex,
    granule,
    esClient,
  } = t.context;

  await t.throwsAsync(
    writeGranuleFromApi({ ...granule, granuleId: undefined }, knex, esClient, 'Create'),
    { message: 'Could not create granule record, invalid granuleId: undefined' }
  );
});

test.serial('writeGranuleFromApi() throws for a granule with an invalid collectionId', async (t) => {
  const {
    esClient,
    granule,
    knex,
  } = t.context;

  await t.throwsAsync(
    writeGranuleFromApi({ ...granule, collectionId: constructCollectionId('wrong____', 'collection') }, knex, esClient, 'Create'),
    { message: 'Record in collections with identifiers {"name":"wrong____","version":"collection"} does not exist.' }
  );
});

test.serial('writeGranuleFromApi() throws for a granule with no collectionId provided', async (t) => {
  const {
    esClient,
    knex,
    granule,
  } = t.context;

  await t.throwsAsync(
    writeGranuleFromApi({ ...granule, collectionId: undefined }, knex, esClient, 'Create'),
    { message: 'collectionId required to generate a granule record' }
  );
});

test.serial('writeGranuleFromApi() throws for a granule with an invalid collectionId provided', async (t) => {
  const {
    esClient,
    knex,
    granule,
  } = t.context;
  const badCollectionId = `collectionId${cryptoRandomString({ length: 5 })}`;
  await t.throwsAsync(
    writeGranuleFromApi({ ...granule, collectionId: badCollectionId }, knex, esClient, 'Create'),
    { message: `invalid collectionId: "${badCollectionId}"` }
  );
});

test.serial('writeGranuleFromApi() writes a granule to PostgreSQL and Elasticsearch.', async (t) => {
  const {
    collectionCumulusId,
    esClient,
    esGranulesClient,
    granule,
    granuleId,
    granulePgModel,
    knex,
  } = t.context;

  const result = await writeGranuleFromApi({ ...granule, error: {} }, knex, esClient, 'Create');

  t.is(result, `Wrote Granule ${granuleId}`);

  const postgresRecord = await granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );
  const esRecord = await esGranulesClient.get(granuleId);
  const postgresActual = await translatePostgresGranuleToApiGranule({
    knexOrTransaction: knex,
    granulePgRecord: postgresRecord,
  });

  t.deepEqual({
    ...granule,
    _id: esRecord._id,
    timestamp: postgresActual.timestamp,
    error: {},
  }, esRecord);

  t.deepEqual(
    {
      ...granule,
      timestamp: postgresActual.timestamp,
      files: orderBy(granule.files, ['bucket', 'key']),
      error: {},
    },

    {
      ...postgresActual,
      files: orderBy(postgresActual.files, ['bucket', 'key']),
    }
  );
});

test.serial('writeGranuleFromApi() writes a granule to PostgreSQL and Elasticsearch and populates a consistent createdAt default value', async (t) => {
  const {
    collectionCumulusId,
    esClient,
    esGranulesClient,
    granule,
    granuleId,
    granulePgModel,
    knex,
  } = t.context;

  delete granule.createdAt;

  const result = await writeGranuleFromApi({ ...granule }, knex, esClient, 'Create');

  t.is(result, `Wrote Granule ${granuleId}`);

  const postgresRecord = await granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );
  const esRecord = await esGranulesClient.get(granuleId);
  const postgresTranslated = await translatePostgresGranuleToApiGranule({
    knexOrTransaction: knex,
    granulePgRecord: postgresRecord,
  });

  const defaultCreatedAt = postgresTranslated.createdAt;
  const defaultTimestamp = postgresTranslated.timestamp;

  t.deepEqual({
    ...granule,
    _id: esRecord._id,
    createdAt: defaultCreatedAt,
    timestamp: defaultTimestamp,
  }, esRecord);

  t.deepEqual(
    {
      ...granule,
      createdAt: defaultCreatedAt,
      files: orderBy(granule.files, ['bucket', 'key']),
      timestamp: defaultTimestamp,
    },

    {
      ...postgresTranslated,
      files: orderBy(postgresTranslated.files, ['bucket', 'key']),
    }
  );
});

test.serial('writeGranuleFromApi() given a payload with undefined files, keeps existing files in all datastores', async (t) => {
  const {
    collectionCumulusId,
    esClient,
    esGranulesClient,
    files,
    granule,
    granulePgModel,
    knex,
    granuleId,
  } = t.context;

  await writeGranuleFromApi({ ...granule }, knex, esClient, 'Create');

  const originalEsGranule = await esGranulesClient.get(granuleId);
  const originalpgGranule = await granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );
  const originalApiGranule = await translatePostgresGranuleToApiGranule({
    granulePgRecord: originalpgGranule,
    knexOrTransaction: knex,
  });

  const originalPayloadFiles = files;

  originalPayloadFiles.sort(
    (f1, f2) => sortFilesByBuckets(f1, f2)
  );
  originalApiGranule.files.sort(
    (f1, f2) => sortFilesByBuckets(f1, f2)
  );
  originalEsGranule.files.sort(
    (f1, f2) => sortFilesByBuckets(f1, f2)
  );

  // Files were written correctly in initial DB writes
  t.true(originalPayloadFiles.length > 0);
  t.deepEqual(originalEsGranule.files, originalPayloadFiles);
  t.deepEqual(originalApiGranule.files, originalPayloadFiles);

  // Update existing granule with a partial granule object
  const updateGranulePayload = {
    granuleId,
    collectionId: granule.collectionId,
    cmrLink: 'updatedGranuled.com', // Only field we're changing
    status: granule.status,
    // files is undefined
  };

  const {
    pgGranule,
    esGranule,
  } = await updateGranule(t, updateGranulePayload);

  const apiGranule = await translatePostgresGranuleToApiGranule({
    granulePgRecord: pgGranule,
    knexOrTransaction: knex,
  });

  esGranule.files.sort(
    (f1, f2) => sortFilesByBuckets(f1, f2)
  );
  apiGranule.files.sort(
    (f1, f2) => sortFilesByBuckets(f1, f2)
  );

  t.deepEqual(apiGranule.files, originalPayloadFiles);
  t.deepEqual(esGranule.files, originalPayloadFiles);
});

test.serial('writeGranuleFromApi() given a partial granule overwrites only provided fields', async (t) => {
  const {
    collectionCumulusId,
    esClient,
    esGranulesClient,
    granule,
    granuleId,
    granulePgModel,
    knex,
  } = t.context;

  await writeGranuleFromApi({ ...granule }, knex, esClient, 'Create');

  t.true(await granulePgModel.exists(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  ));
  t.true(await esGranulesClient.exists(granuleId));

  const originalpgGranule = await granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );

  // Update existing granule with a partial granule object
  const updateGranulePayload = {
    granuleId,
    collectionId: granule.collectionId,
    cmrLink: 'updatedGranuled.com', // Only field we're changing
    status: granule.status,
  };

  const {
    updatedPgGranuleFields,
    pgGranule,
    esGranule,
  } = await updateGranule(t, updateGranulePayload);

  // Postgres granule matches expected updatedGranule
  t.deepEqual(
    omit(removeNilProperties(pgGranule), pgFormatOmitList),
    omit(removeNilProperties({ ...originalpgGranule, ...updatedPgGranuleFields }), pgFormatOmitList)
  );

  const apiGranule = await translatePostgresGranuleToApiGranule({
    granulePgRecord: pgGranule,
    knexOrTransaction: knex,
  });

  // Files array order not guarunteed to match between datastores
  esGranule.files.sort(
    (f1, f2) => sortFilesByBuckets(f1, f2)
  );
  apiGranule.files.sort(
    (f1, f2) => sortFilesByBuckets(f1, f2)
  );

  // Postgres and ElasticSearch granules matches
  t.deepEqual(
    apiGranule,
    omit(esGranule, ['_id'])
  );
});

test.serial('writeGranuleFromApi() given a granule with all fields populated is written to the DB, on update removes all expected nullified fields from all datastores', async (t) => {
  const {
    collection,
    collectionCumulusId,
    esClient,
    esGranulesClient,
    executionUrl,
    files,
    granulePgModel,
    knex,
    pdr,
    provider,
    granuleId,
  } = t.context;

  const validNullableGranuleKeys = [
    'beginningDateTime',
    'cmrLink',
    'createdAt',
    'duration',
    'endingDateTime',
    'files',
    'lastUpdateDateTime',
    'pdrName',
    'processingEndDateTime',
    'processingStartDateTime',
    'productionDateTime',
    'productVolume',
    'provider',
    'published',
    'queryFields',
    'timestamp',
    'timeToArchive',
    'timeToPreprocess',
    'updatedAt',
  ];

  const completeGranule = fakeGranuleFactoryV2({
    beginningDateTime: new Date().toISOString(),
    cmrLink: 'example.com',
    collectionId: constructCollectionId(collection.name, collection.version),
    createdAt: Date.now(),
    duration: 1000,
    endingDateTime: new Date().toISOString(),
    error: { errorKey: 'errorValue' },
    execution: executionUrl,
    files: files,
    granuleId: granuleId,
    lastUpdateDateTime: new Date().toISOString(),
    pdrName: pdr.name,
    processingEndDateTime: new Date().toISOString(),
    processingStartDateTime: new Date().toISOString(),
    productionDateTime: new Date().toISOString(),
    productVolume: '1000',
    provider: provider.name,
    published: true,
    queryFields: { queryFieldsKey: 'queryFieldsValue' },
    status: 'completed',
    timestamp: 1,
    timeToArchive: 1000,
    timeToPreprocess: 1000,
    updatedAt: Date.now(),
  });

  await writeGranuleFromApi({ ...completeGranule }, knex, esClient, 'Create');

  t.true(await granulePgModel.exists(
    knex,
    { granule_id: completeGranule.granuleId, collection_cumulus_id: collectionCumulusId }
  ));
  t.true(await esGranulesClient.exists(completeGranule.granuleId));

  const originalpgGranule = await granulePgModel.get(
    knex,
    { granule_id: completeGranule.granuleId, collection_cumulus_id: collectionCumulusId }
  );
  const originalApiFormattedPostgresGranule = await translatePostgresGranuleToApiGranule({
    granulePgRecord: originalpgGranule,
    knexOrTransaction: knex,
  });

  // Update existing granule with a granule object with all valid nullified values set
  validNullableGranuleKeys.forEach((key) => {
    completeGranule[key] = null;
  });

  const {
    pgGranule,
    esGranule,
  } = await updateGranule(t, completeGranule);

  const apiFormattedPostgresGranule = await translatePostgresGranuleToApiGranule({
    granulePgRecord: pgGranule,
    knexOrTransaction: knex,
  });

  // Translated postgres granule matches expected updatedGranule
  // minus model defaults
  t.deepEqual(
    omit(removeNilProperties(apiFormattedPostgresGranule), apiFormatOmitList),
    {
      ...omit(
        removeNilProperties({ ...originalApiFormattedPostgresGranule }),
        validNullableGranuleKeys.concat(apiFormatOmitList)
      ),
      files: [],
    }
  );

  // Validate that all of the nullable keys are unset
  t.deepEqual(apiFormattedPostgresGranule.files, []);
  const undefinedApiKeys = validNullableGranuleKeys.filter(
    (i) => !apiFormatOmitList.includes(i) && i !== 'files'
  );
  // Validate files key is 'removed'
  t.deepEqual(
    validNullableGranuleKeys
      .filter((key) => apiFormattedPostgresGranule[key] === undefined)
      .sort(),
    undefinedApiKeys.sort()
  );

  // Postgres and ElasticSearch granules matches
  t.deepEqual(
    omit(apiFormattedPostgresGranule, ['files']),
    omit(esGranule, ['_id'])
  );
  // Validate that none of the responses come back as 'null', we want them removed, not set
  t.is(validNullableGranuleKeys.filter((key) => esGranule[key] === null).length, 0);
  // Validate that all of the nullable keys are unset
  const undefinedEsKeys = validNullableGranuleKeys.filter((i) => !apiFormatOmitList.includes(i));
  t.deepEqual(
    validNullableGranuleKeys
      .filter((key) => esGranule[key] === undefined)
      .sort(),
    undefinedEsKeys.sort()
  );
});

test.serial('writeGranuleFromApi() when called on a granuleId that exists in the datastore does not modify the `published` field if it is not set', async (t) => {
  const {
    collectionCumulusId,
    esClient,
    esGranulesClient,
    granule,
    granuleId,
    granulePgModel,
    knex,
  } = t.context;

  await writeGranuleFromApi({ ...granule, published: true }, knex, esClient, 'Create');

  t.true(await granulePgModel.exists(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  ));
  t.true(await esGranulesClient.exists(granuleId));

  const originalPgGranule = await granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );

  // Update existing granule with a partial granule object
  const updateGranulePayload = {
    granuleId,
    collectionId: granule.collectionId,
    cmrLink: 'updatedGranuled.com', // Only field we're changing
    status: granule.status,
  };

  const {
    pgGranule,
    esGranule,
  } = await updateGranule(t, updateGranulePayload);

  t.is(pgGranule.published, originalPgGranule.published);

  const apiGranule = await translatePostgresGranuleToApiGranule({
    granulePgRecord: pgGranule,
    knexOrTransaction: knex,
  });

  t.is(apiGranule.published, esGranule.published);
});

test.serial('writeGranuleFromApi() given an empty array as a files key will remove all existing files and keep Postgres/Elastic in-sync', async (t) => {
  const {
    collectionCumulusId,
    esClient,
    esGranulesClient,
    files,
    granule,
    granuleId,
    granulePgModel,
    knex,
  } = t.context;

  await writeGranuleFromApi({ ...granule }, knex, esClient, 'Create');

  const originalEsGranule = await esGranulesClient.get(granuleId);
  const originalpgGranule = await granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );
  const originalApiGranule = await translatePostgresGranuleToApiGranule({
    granulePgRecord: originalpgGranule,
    knexOrTransaction: knex,
  });

  const originalPayloadFiles = files;

  originalPayloadFiles.sort(
    (f1, f2) => sortFilesByBuckets(f1, f2)
  );
  originalApiGranule.files.sort(
    (f1, f2) => sortFilesByBuckets(f1, f2)
  );
  originalEsGranule.files.sort(
    (f1, f2) => sortFilesByBuckets(f1, f2)
  );

  // Files were written correctly in initial DB writes
  t.deepEqual(originalEsGranule.files, originalPayloadFiles);
  t.deepEqual(originalApiGranule.files, originalPayloadFiles);

  // Update existing granule with a partial granule object
  const updateGranulePayload = {
    granuleId,
    collectionId: granule.collectionId,
    files: [],
    status: granule.status,
  };

  const {
    updatedPgGranuleFields,
    pgGranule,
    esGranule,
  } = await updateGranule(t, updateGranulePayload);

  // Postgres granule matches expected updatedGranule
  t.deepEqual(
    omit(removeNilProperties(pgGranule), pgFormatOmitList),
    omit(removeNilProperties({ ...originalpgGranule, ...updatedPgGranuleFields }), pgFormatOmitList)
  );

  const apiGranule = await translatePostgresGranuleToApiGranule({
    granulePgRecord: pgGranule,
    knexOrTransaction: knex,
  });

  // Files were removed from all datastores
  t.deepEqual(apiGranule.files, []);
  t.is(esGranule.files, undefined);
});

test.serial('writeGranuleFromApi() writes a granule without an execution', async (t) => {
  const {
    collectionCumulusId,
    esClient,
    granule,
    granuleId,
    granulePgModel,
    knex,
  } = t.context;

  await writeGranuleFromApi({ ...granule, execution: undefined }, knex, esClient, 'Create');

  t.true(await granulePgModel.exists(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  ));
});

test.serial('writeGranuleFromApi() can write a granule with no files associated with it', async (t) => {
  const {
    knex,
    esClient,
    granule,
    granuleId,
    granulePgModel,
    collectionCumulusId,
  } = t.context;

  await writeGranuleFromApi({ ...granule, files: [] }, knex, esClient, 'Create');
  t.true(await granulePgModel.exists(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  ));
});

test.serial('writeGranuleFromApi() throws with granule with an execution url that does not exist', async (t) => {
  const {
    esClient,
    knex,
    granule,
  } = t.context;
  const execution = `execution${cryptoRandomString({ length: 5 })}`;
  await t.throwsAsync(
    writeGranuleFromApi({ ...granule, execution }, knex, esClient, 'Create'),
    { message: `Could not find execution in PostgreSQL database with url ${execution}` }
  );
});

test.serial('writeGranuleFromApi() saves granule records to Postgres and ElasticSearch with same input time values.', async (t) => {
  const {
    esClient,
    knex,
    collectionCumulusId,
    granule,
    granuleId,
    granulePgModel,
  } = t.context;

  const createdAt = Date.now() - 24 * 60 * 60 * 1000;
  const updatedAt = Date.now() - 100000;
  const timestamp = Date.now();

  const result = await writeGranuleFromApi({ ...granule, createdAt, updatedAt, timestamp }, knex, esClient, 'Create');

  t.is(result, `Wrote Granule ${granuleId}`);

  const postgresRecord = await granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );
  const esRecord = await t.context.esGranulesClient.get(granuleId);

  t.truthy(esRecord.timestamp);
  t.is(postgresRecord.created_at.getTime(), esRecord.createdAt);
  t.is(postgresRecord.updated_at.getTime(), esRecord.updatedAt);
  t.is(postgresRecord.timestamp.getTime(), esRecord.timestamp);
});

test.serial('writeGranuleFromApi() saves updated values for running granule record to Postgres and ElasticSearch on rewrite', async (t) => {
  const {
    esClient,
    esGranulesClient,
    knex,
    collectionCumulusId,
    granule,
    granuleId,
    granulePgModel,
  } = t.context;

  await writeGranuleFromApi({ ...granule, status: 'completed', published: true }, knex, esClient, 'Create');
  t.true(await granulePgModel.exists(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  ));
  t.true(await esGranulesClient.exists(granuleId));

  const createdAt = Date.now() - 24 * 60 * 60 * 1000;
  const updatedAt = Date.now() - 100000;
  const timestamp = Date.now();
  const updatedDuration = 100;
  const updatedCmrLink = 'updatedLink';
  const result = await writeGranuleFromApi(
    {
      ...granule,
      createdAt,
      updatedAt,
      timestamp,
      cmrLink: updatedCmrLink,
      duration: updatedDuration,
      status: 'running',
    },
    knex,
    esClient,
    'Create'
  );

  t.is(result, `Wrote Granule ${granuleId}`);

  const postgresRecord = await granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );
  const esRecord = await t.context.esGranulesClient.get(granuleId);

  t.is(postgresRecord.created_at.getTime(), esRecord.createdAt);
  t.is(postgresRecord.updated_at.getTime(), esRecord.updatedAt);
  t.is(postgresRecord.timestamp.getTime(), esRecord.timestamp);

  t.is(postgresRecord.duration, updatedDuration);
  t.is(esRecord.duration, updatedDuration);

  t.is(postgresRecord.cmr_link, updatedCmrLink);
  t.is(esRecord.cmrLink, updatedCmrLink);

  // Validate that value not in API update value is not changed
  t.is(postgresRecord.published, true);
  t.is(esRecord.published, true);

  t.is(postgresRecord.status, 'running');
  t.is(esRecord.status, 'running');
});

test.serial('writeGranuleFromApi() saves updated values for queued granule record to Postgres and ElasticSearch on rewrite', async (t) => {
  const {
    esClient,
    esGranulesClient,
    knex,
    collectionCumulusId,
    granule,
    granuleId,
    granulePgModel,
  } = t.context;

  await writeGranuleFromApi({ ...granule, status: 'completed', published: true }, knex, esClient, 'Create');
  t.true(await granulePgModel.exists(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  ));
  t.true(await esGranulesClient.exists(granuleId));

  const createdAt = Date.now() - 24 * 60 * 60 * 1000;
  const updatedAt = Date.now() - 100000;
  const timestamp = Date.now();
  const updatedDuration = 100;
  const updatedCmrLink = 'updatedLink';
  const result = await writeGranuleFromApi(
    {
      ...granule,
      createdAt,
      updatedAt,
      timestamp,
      cmrLink: updatedCmrLink,
      duration: updatedDuration,
      status: 'queued',
    },
    knex,
    esClient,
    'Create'
  );

  t.is(result, `Wrote Granule ${granuleId}`);

  const postgresRecord = await granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );
  const esRecord = await t.context.esGranulesClient.get(granuleId);

  t.is(postgresRecord.created_at.getTime(), esRecord.createdAt);
  t.is(postgresRecord.updated_at.getTime(), esRecord.updatedAt);
  t.is(postgresRecord.timestamp.getTime(), esRecord.timestamp);

  t.is(postgresRecord.duration, updatedDuration);
  t.is(esRecord.duration, updatedDuration);

  t.is(postgresRecord.cmr_link, updatedCmrLink);
  t.is(esRecord.cmrLink, updatedCmrLink);

  // Validate that value not in API update value is not changed
  t.is(postgresRecord.published, true);
  t.is(esRecord.published, true);

  t.is(postgresRecord.status, 'queued');
  t.is(esRecord.status, 'queued');
});

test.serial('writeGranuleFromApi() saves granule records to Postgres and ElasticSearch with same default time values.', async (t) => {
  const {
    esClient,
    knex,
    collectionCumulusId,
    granule,
    granuleId,
    granulePgModel,
  } = t.context;

  const createdAt = undefined;
  const updatedAt = undefined;
  const timestamp = undefined;

  const result = await writeGranuleFromApi({ ...granule, createdAt, updatedAt, timestamp }, knex, esClient, 'Create');

  t.is(result, `Wrote Granule ${granuleId}`);

  const postgresRecord = await granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );
  const esRecord = await t.context.esGranulesClient.get(granuleId);

  t.truthy(esRecord.timestamp);
  t.is(postgresRecord.created_at.getTime(), esRecord.createdAt);
  t.is(postgresRecord.updated_at.getTime(), esRecord.updatedAt);
  t.is(postgresRecord.timestamp.getTime(), esRecord.timestamp);
  t.is(postgresRecord.timestamp.getTime(), esRecord.updatedAt);
});

test.serial('writeGranuleFromApi() saves file records to Postgres if Postgres write is enabled and workflow status is "completed"', async (t) => {
  const {
    collectionCumulusId,
    esClient,
    filePgModel,
    granule,
    granuleId,
    granulePgModel,
    knex,
  } = t.context;

  await writeGranuleFromApi({ ...granule, status: 'completed' }, knex, esClient, 'Create');

  const granuleRecord = await granulePgModel.get(
    knex,
    {
      granule_id: granuleId,
      collection_cumulus_id: collectionCumulusId,
    }
  );

  t.true(
    await filePgModel.exists(knex, { granule_cumulus_id: granuleRecord.cumulus_id })
  );
});

test.serial('writeGranuleFromApi() writes all valid files if any non-valid file fails', async (t) => {
  const {
    esClient,
    filePgModel,
    granulePgModel,
    granule,
    knex,
  } = t.context;

  const invalidFiles = [
    fakeFileFactory({ bucket: undefined }),
    fakeFileFactory({ bucket: undefined }),
  ];
  const allfiles = [...t.context.files].concat(invalidFiles);

  const validFiles = 10;
  for (let i = 0; i < validFiles; i += 1) {
    allfiles.push(fakeFileFactory());
  }
  const validFileCount = allfiles.length - invalidFiles.length;

  await writeGranuleFromApi({ ...granule, files: allfiles }, knex, esClient, 'Create');

  t.false(await filePgModel.exists(knex, { key: invalidFiles[0].key }));
  t.false(await filePgModel.exists(knex, { key: invalidFiles[1].key }));

  const granuleCumulusId = await granulePgModel.getRecordCumulusId(
    knex,
    { granule_id: granule.granuleId }
  );
  const fileRecords = await filePgModel.search(knex, { granule_cumulus_id: granuleCumulusId });
  t.is(fileRecords.length, validFileCount);
});

test.serial('writeGranuleFromApi() stores error on granule if any file fails', async (t) => {
  const {
    collectionCumulusId,
    esClient,
    granule,
    knex,
    granuleId,
  } = t.context;

  const invalidFiles = [
    fakeFileFactory({ bucket: undefined }),
    fakeFileFactory({ bucket: undefined }),
  ];

  const existingFiles = [...t.context.files];
  const files = existingFiles.concat(invalidFiles);

  const validFiles = 10;
  for (let i = 0; i < validFiles; i += 1) {
    files.push(fakeFileFactory());
  }

  await writeGranuleFromApi(
    { ...granule, status: 'completed', files },
    knex,
    esClient,
    'Create'
  );

  const pgGranule = await t.context.granulePgModel.get(
    knex, { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );
  const pgGranuleError = JSON.parse(pgGranule.error.errors);
  t.deepEqual(pgGranuleError.map((error) => error.Error), ['Failed writing files to PostgreSQL.']);
  t.true(pgGranuleError[0].Cause.includes('AggregateError'));
});

test.serial('writeGranuleFromApi() allows update of complete granule record in all datastores if older granule exists with same execution in a completed state', async (t) => {
  const {
    esClient,
    esGranulesClient,
    knex,
    collectionCumulusId,
    granule,
    granuleId,
    granulePgModel,
  } = t.context;

  await writeGranuleFromApi({ ...granule, status: 'completed', published: true }, knex, esClient, 'Create');
  t.true(await granulePgModel.exists(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  ));
  t.true(await esGranulesClient.exists(granuleId));

  const createdAt = Date.now() - 24 * 60 * 60 * 1000;
  const updatedAt = Date.now() - 100000;
  const timestamp = Date.now();
  const updatedDuration = 100;
  const updatedCmrLink = 'updatedLink';
  const result = await writeGranuleFromApi(
    {
      ...granule,
      createdAt,
      updatedAt,
      timestamp,
      cmrLink: updatedCmrLink,
      duration: updatedDuration,
      status: 'running',
    },
    knex,
    esClient,
    'Create'
  );

  t.is(result, `Wrote Granule ${granuleId}`);

  const postgresRecord = await granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );
  const esRecord = await t.context.esGranulesClient.get(granuleId);

  t.is(postgresRecord.created_at.getTime(), esRecord.createdAt);
  t.is(postgresRecord.updated_at.getTime(), esRecord.updatedAt);
  t.is(postgresRecord.timestamp.getTime(), esRecord.timestamp);

  t.is(postgresRecord.duration, updatedDuration);
  t.is(esRecord.duration, updatedDuration);

  t.is(postgresRecord.cmr_link, updatedCmrLink);
  t.is(esRecord.cmrLink, updatedCmrLink);

  // Validate that value not in API update value is not changed
  t.is(postgresRecord.published, true);
  t.is(esRecord.published, true);
});

test.serial('writeGranuleFromApi() allows overwrite of granule records in all datastores if granule exists with newer createdAt and has same execution in a completed state', async (t) => {
  const {
    esClient,
    executionUrl,
    esGranulesClient,
    knex,
    collectionCumulusId,
    granule,
    granuleId,
    granulePgModel,
  } = t.context;

  await writeGranuleFromApi({ ...granule, status: 'completed', published: true, execution: executionUrl }, knex, esClient, 'Create');
  t.true(await granulePgModel.exists(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  ));
  t.true(await esGranulesClient.exists(granuleId));

  const createdAt = 1;
  const updatedAt = Date.now() - 100000;
  const timestamp = Date.now();
  const updatedDuration = 100;
  const updatedCmrLink = 'updatedLink';
  const result = await writeGranuleFromApi(
    {
      ...granule,
      createdAt,
      updatedAt,
      timestamp,
      cmrLink: updatedCmrLink,
      duration: updatedDuration,
      status: 'running',
    },
    knex,
    esClient,
    'Create'
  );

  t.is(result, `Wrote Granule ${granuleId}`);

  const postgresRecord = await granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );
  const esRecord = await t.context.esGranulesClient.get(granuleId);

  const translatedPgGranule = await translatePostgresGranuleToApiGranule({
    knexOrTransaction: knex,
    granulePgRecord: postgresRecord,
  });

  t.is(postgresRecord.created_at.getTime(), esRecord.createdAt);
  t.is(postgresRecord.updated_at.getTime(), esRecord.updatedAt);
  t.is(postgresRecord.timestamp.getTime(), esRecord.timestamp);

  t.is(postgresRecord.duration, updatedDuration);
  t.is(esRecord.duration, updatedDuration);

  t.is(postgresRecord.cmr_link, updatedCmrLink);
  t.is(esRecord.cmrLink, updatedCmrLink);

  // Validate that value not in API update value is not changed
  t.is(postgresRecord.published, true);
  t.is(esRecord.published, true);

  t.is(translatedPgGranule.execution, executionUrl);
  t.is(esRecord.execution, executionUrl);
});

test.serial('writeGranuleFromApi() allows overwrite of granule records in all datastores and associates with new execution if granule exists with newer createdAt and an existing execution is in a completed state', async (t) => {
  const {
    esClient,
    esGranulesClient,
    executionUrl,
    knex,
    collectionCumulusId,
    granule,
    granuleId,
    granulePgModel,
  } = t.context;

  await writeGranuleFromApi({ ...granule, status: 'completed', published: true, execution: executionUrl }, knex, esClient, 'Create');
  t.true(await granulePgModel.exists(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  ));
  t.true(await esGranulesClient.exists(granuleId));

  const stateMachineName = cryptoRandomString({ length: 5 });
  const newExecutionName = cryptoRandomString({ length: 5 });
  const newExecutionArn = `arn:aws:states:us-east-1:12345:execution:${stateMachineName}:${newExecutionName}`;
  const newExecutionUrl = getExecutionUrlFromArn(newExecutionArn);
  const newExecution = fakeExecutionRecordFactory({
    arn: newExecutionArn,
    url: newExecutionUrl,
    status: 'completed',
  });
  await t.context.executionPgModel.create(
    t.context.knex,
    newExecution
  );

  const createdAt = 1;
  const updatedAt = Date.now() - 100000;
  const timestamp = Date.now();
  const updatedDuration = 100;
  const updatedCmrLink = 'updatedLink';
  const result = await writeGranuleFromApi(
    {
      ...granule,
      createdAt,
      updatedAt,
      timestamp,
      cmrLink: updatedCmrLink,
      duration: updatedDuration,
      execution: newExecutionUrl,
      status: 'running',
    },
    knex,
    esClient,
    'Create'
  );

  t.is(result, `Wrote Granule ${granuleId}`);

  const postgresRecord = await granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );
  const esRecord = await t.context.esGranulesClient.get(granuleId);

  const translatedPgGranule = await translatePostgresGranuleToApiGranule({
    knexOrTransaction: knex,
    granulePgRecord: postgresRecord,
  });

  t.is(postgresRecord.created_at.getTime(), esRecord.createdAt);
  t.is(postgresRecord.updated_at.getTime(), esRecord.updatedAt);
  t.is(postgresRecord.timestamp.getTime(), esRecord.timestamp);

  t.is(postgresRecord.duration, updatedDuration);
  t.is(esRecord.duration, updatedDuration);

  t.is(postgresRecord.cmr_link, updatedCmrLink);
  t.is(esRecord.cmrLink, updatedCmrLink);

  // Validate that value not in API update value is not changed
  t.is(postgresRecord.published, true);
  t.is(esRecord.published, true);

  t.is(translatedPgGranule.execution, newExecutionUrl);
  t.is(esRecord.execution, newExecutionUrl);
});

test.serial('updateGranuleStatusToQueued() updates granule status in PostgreSQL/Elasticsearch and publishes SNS message', async (t) => {
  const {
    collectionCumulusId,
    esGranulesClient,
    esClient,
    granule,
    granuleId,
    granulePgModel,
    knex,
    QueueUrl,
  } = t.context;

  await writeGranuleFromApi({ ...granule }, knex, esClient, 'Create');
  const postgresRecord = await granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );
  const esRecord = await esGranulesClient.get(granuleId, granule.collectionId);
  const apiGranule = await translatePostgresGranuleToApiGranule({
    granulePgRecord: postgresRecord,
    knexOrTransaction: knex,
  });

  await updateGranuleStatusToQueued({
    apiGranule: apiGranule,
    knex,
  });

  const updatedPostgresRecord = await granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );
  const omitList = ['_id', 'execution', 'status', 'updatedAt', 'updated_at', 'files'];
  const sortByKeys = ['bucket', 'key'];
  const updatedEsRecord = await esGranulesClient.get(granuleId, granule.collectionId);
  const translatedPgGranule = await translatePostgresGranuleToApiGranule({
    granulePgRecord: updatedPostgresRecord,
    knexOrTransaction: knex,
  });

  t.is(updatedPostgresRecord.status, 'queued');
  t.is(updatedEsRecord.status, 'queued');
  t.is(translatedPgGranule.execution, apiGranule.execution);
  t.deepEqual(omit(postgresRecord, omitList), omit(updatedPostgresRecord, omitList));
  t.deepEqual(sortBy(translatedPgGranule.files, sortByKeys), sortBy(esRecord.files, sortByKeys));
  t.deepEqual(omit(esRecord, omitList), omit(updatedEsRecord, omitList));
  t.deepEqual(omit(translatedPgGranule, omitList), omit(updatedEsRecord, omitList));

  const { Messages } = await sqs().receiveMessage({
    QueueUrl,
    MaxNumberOfMessages: 2,
    WaitTimeSeconds: 10,
  }).promise();
  const snsMessageBody = JSON.parse(Messages[1].Body);
  const publishedMessage = JSON.parse(snsMessageBody.Message);

  t.is(Messages.length, 2);
  t.deepEqual(publishedMessage.record, translatedPgGranule);
  t.is(publishedMessage.event, 'Update');
});

test.serial('updateGranuleStatusToQueued() throws error if record does not exist in pg', async (t) => {
  const {
    esClient,
    knex,
    granule,
    granuleId,
  } = t.context;

  await writeGranuleFromApi({ ...granule }, knex, esClient, 'Create');

  const name = randomId('name');
  const version = randomId('version');
  const badGranule = fakeGranuleFactoryV2({
    granuleId,
    collectionId: constructCollectionId(name, version),
  });
  await t.throwsAsync(
    updateGranuleStatusToQueued({ apiGranule: badGranule, knex }),
    {
      name: 'RecordDoesNotExist',
      message: `Record in collections with identifiers {"name":"${name}","version":"${version}"} does not exist.`,
    }
  );
});

test.serial('updateGranuleStatusToQueued() does not update Elasticsearch granule if writing to PostgreSQL fails', async (t) => {
  const {
    collectionCumulusId,
    esGranulesClient,
    esClient,
    granule,
    granuleId,
    granulePgModel,
    knex,
  } = t.context;

  const testGranulePgModel = {
    get: () => Promise.resolve(granule),
    update: () => {
      throw new Error('Granules Postgres error');
    },
  };

  await writeGranuleFromApi({ ...granule }, knex, esClient, 'Create');
  const postgresRecord = await granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );

  const apiGranule = await translatePostgresGranuleToApiGranule({
    granulePgRecord: postgresRecord,
    knexOrTransaction: knex,
  });
  const esRecord = await esGranulesClient.get(granuleId, granule.collectionId);

  t.is(postgresRecord.status, 'completed');
  t.is(esRecord.status, 'completed');
  t.truthy(apiGranule.execution);

  await t.throwsAsync(
    updateGranuleStatusToQueued({
      apiGranule,
      knex,
      granulePgModel: testGranulePgModel,
    }),
    { message: 'Granules Postgres error' }
  );

  const updatedPostgresRecord = await granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );
  const updatedEsRecord = await esGranulesClient.get(granuleId, granule.collectionId);
  const translatedPgGranule = await translatePostgresGranuleToApiGranule({
    granulePgRecord: updatedPostgresRecord,
    knexOrTransaction: knex,
  });
  const omitList = ['_id', 'execution', 'updatedAt', 'updated_at', 'files'];
  const sortByKeys = ['bucket', 'key'];

  t.not(updatedPostgresRecord.status, 'queued');
  t.not(esRecord.status, 'queued');
  t.not(translatedPgGranule.execution, undefined);

  // Check that granules are equal in all data stores
  t.deepEqual(omit(postgresRecord, omitList), omit(updatedPostgresRecord, omitList));
  t.deepEqual(sortBy(translatedPgGranule.files, sortByKeys), sortBy(esRecord.files, sortByKeys));
  t.deepEqual(omit(esRecord, omitList), omit(updatedEsRecord, omitList));
  t.deepEqual(omit(translatedPgGranule, omitList), omit(esRecord, omitList));
});

test.serial('updateGranuleStatusToQueued() does not update PostgreSQL granule if writing to Elasticsearch fails', async (t) => {
  const {
    collectionCumulusId,
    esGranulesClient,
    esClient,
    granule,
    granuleId,
    granulePgModel,
    knex,
  } = t.context;

  const fakeEsClient = {
    update: () => {
      throw new Error('Elasticsearch failure');
    },
    delete: () => Promise.resolve(),
  };

  await writeGranuleFromApi({ ...granule }, knex, esClient, 'Create');
  const postgresRecord = await granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );
  const apiGranule = await translatePostgresGranuleToApiGranule({
    granulePgRecord: postgresRecord,
    knexOrTransaction: knex,
  });
  const esRecord = await esGranulesClient.get(granuleId, granule.collectionId);

  t.is(postgresRecord.status, 'completed');
  t.is(esRecord.status, 'completed');
  // Should we consider making this an explicit granule execution PG call?
  t.truthy(apiGranule.execution);

  await t.throwsAsync(
    updateGranuleStatusToQueued({
      apiGranule,
      knex,
      esClient: fakeEsClient,
    }),
    { message: 'Elasticsearch failure' }
  );

  const updatedPostgresRecord = await granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );
  const updatedEsRecord = await esGranulesClient.get(granuleId, granule.collectionId);
  const translatedPgGranule = await translatePostgresGranuleToApiGranule({
    granulePgRecord: updatedPostgresRecord,
    knexOrTransaction: knex,
  });
  const omitList = ['_id', 'execution', 'updatedAt', 'updated_at', 'files'];
  const sortByKeys = ['bucket', 'key'];

  t.not(updatedPostgresRecord.status, 'queued');
  t.not(esRecord.status, 'queued');

  // Check that granules are equal in all data stores
  t.deepEqual(omit(postgresRecord, omitList), omit(updatedPostgresRecord, omitList));
  t.deepEqual(sortBy(translatedPgGranule.files, sortByKeys), sortBy(esRecord.files, sortByKeys));
  t.deepEqual(omit(esRecord, omitList), omit(updatedEsRecord, omitList));
  t.deepEqual(omit(translatedPgGranule, omitList), omit(esRecord, omitList));
});

test.serial('_writeGranule() successfully publishes an SNS message', async (t) => {
  const {
    granule,
    executionCumulusId,
    esClient,
    knex,
    granulePgModel,
    granuleId,
    QueueUrl,
  } = t.context;

  const apiGranuleRecord = {
    ...granule,
    status: 'completed',
  };
  const postgresGranuleRecord = await translateApiGranuleToPostgresGranule({
    dynamoRecord: apiGranuleRecord,
    knexOrTransaction: knex,
  });

  await _writeGranule({
    apiGranuleRecord,
    postgresGranuleRecord,
    executionCumulusId,
    granulePgModel,
    knex,
    esClient,
    snsEventType: 'Update',
  });

  t.true(await t.context.esGranulesClient.exists(granuleId));

  const retrievedPgGranule = await granulePgModel.get(knex, {
    granule_id: granuleId,
    collection_cumulus_id: postgresGranuleRecord.collection_cumulus_id,
  });
  const translatedGranule = await translatePostgresGranuleToApiGranule({
    granulePgRecord: retrievedPgGranule,
    knexOrTransaction: knex,
  });

  const { Messages } = await sqs().receiveMessage({ QueueUrl, WaitTimeSeconds: 10 }).promise();
  t.is(Messages.length, 1);

  const snsMessageBody = JSON.parse(Messages[0].Body);
  const publishedMessage = JSON.parse(snsMessageBody.Message);

  t.deepEqual(publishedMessage.record, translatedGranule);
  t.is(publishedMessage.event, 'Update');
});

test.serial('updateGranuleStatusToFailed() updates granule status in the database', async (t) => {
  const {
    knex,
    collectionCumulusId,
    granule,
    granuleId,
    granulePgModel,
  } = t.context;
  const fakeEsClient = {
    update: () => Promise.resolve(),
    delete: () => Promise.resolve(),
  };
  granule.status = 'running';
  const snsEventType = 'Update';

  try {
    await writeGranuleFromApi({ ...granule }, knex, fakeEsClient, snsEventType);
  } catch (error) {
    console.log(`initial write: ${JSON.stringify(error)}`);
  }
  const granulePgRecord = await granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );
  t.not(granulePgRecord.status, 'failed');

  const apiGranule = await translatePostgresGranuleToApiGranule({
    granulePgRecord,
    knexOrTransaction: knex,
  });

  const fakeErrorObject = { Error: 'This is a fake error', Cause: { Error: 'caused by some fake issue' } };
  await updateGranuleStatusToFailed(
    { granule: apiGranule, knex, error: fakeErrorObject, fakeEsClient }
  );
  const updatedPostgresRecord = await granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );
  t.is(updatedPostgresRecord.status, 'failed');
});

test.serial('updateGranuleStatusToFailed() throws error if record does not exist in pg', async (t) => {
  const {
    knex,
    granuleId,
    esClient,
  } = t.context;

  const name = randomId('name');
  const version = randomId('version');
  const badGranule = fakeGranuleFactoryV2({
    granuleId,
    collectionId: constructCollectionId(name, version),
  });
  const fakeErrorObject = { Error: 'This is a fake error', Cause: { Error: 'caused by some fake issue' } };
  await t.throwsAsync(
    updateGranuleStatusToFailed(
      { granule: badGranule, knex, error: fakeErrorObject, esClient }
    ),
    {
      name: 'RecordDoesNotExist',
      message: `Record in collections with identifiers {"name":"${name}","version":"${version}"} does not exist.`,
    }
  );
});

test.serial('writeGranuleFromApi() overwrites granule record with publish set to null with publish value set to false to all datastores', async (t) => {
  const {
    esClient,
    knex,
    collectionCumulusId,
    granule,
    granuleId,
    granulePgModel,
  } = t.context;

  const result = await writeGranuleFromApi({ ...granule, published: true }, knex, esClient, 'Create');
  t.is(result, `Wrote Granule ${granuleId}`);

  const originalPostgresRecord = await granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );

  t.true(originalPostgresRecord.published);

  const updateResult = await writeGranuleFromApi({ ...granule, published: null }, knex, esClient, 'Create');
  t.is(updateResult, `Wrote Granule ${granuleId}`);

  const postgresRecord = await granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );
  const esRecord = await t.context.esGranulesClient.get(granuleId);

  t.false(postgresRecord.published);
  t.false(esRecord.published);
});

test.serial('writeGranuleFromApi() overwrites granule record with publish set to true with publish value set to true to all datastores', async (t) => {
  const {
    esClient,
    knex,
    collectionCumulusId,
    granule,
    granuleId,
    granulePgModel,
  } = t.context;

  const result = await writeGranuleFromApi({ ...granule, published: true }, knex, esClient, 'Create');
  t.is(result, `Wrote Granule ${granuleId}`);

  const originalPostgresRecord = await granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );

  t.true(originalPostgresRecord.published);

  const updateResult = await writeGranuleFromApi({ ...granule, published: true }, knex, esClient, 'Create');
  t.is(updateResult, `Wrote Granule ${granuleId}`);

  const postgresRecord = await granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );
  const esRecord = await t.context.esGranulesClient.get(granuleId);

  t.true(postgresRecord.published);
  t.true(esRecord.published);
});

test.serial('writeGranuleFromApi() overwrites granule record with error set to null with error value set to "{}" to all datastores', async (t) => {
  const {
    esClient,
    knex,
    collectionCumulusId,
    granule,
    granuleId,
    granulePgModel,
  } = t.context;

  const result = await writeGranuleFromApi(granule, knex, esClient, 'Create');
  t.is(result, `Wrote Granule ${granuleId}`);

  const updateResult = await writeGranuleFromApi({ ...granule, error: null }, knex, esClient, 'Create');
  t.is(updateResult, `Wrote Granule ${granuleId}`);

  const granulePgRecord = await granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );
  const esRecord = await t.context.esGranulesClient.get(granuleId);

  t.deepEqual(granulePgRecord.error, {});
  t.deepEqual(esRecord.error, {});
});

test.serial('writeGranuleFromApi() overwrites granule record with error set with expected value to all datastores', async (t) => {
  const {
    esClient,
    knex,
    collectionCumulusId,
    granule,
    granuleId,
    granulePgModel,
  } = t.context;

  const result = await writeGranuleFromApi({ ...granule, error: null }, knex, esClient, 'Create');
  t.is(result, `Wrote Granule ${granuleId}`);

  const updatedError = { fakeErrorKey: 'fakeErrorValue' };
  const updateResult = await writeGranuleFromApi({ ...granule, error: updatedError }, knex, esClient, 'Create');
  t.is(updateResult, `Wrote Granule ${granuleId}`);

  const granulePgRecord = await granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );
  const esRecord = await t.context.esGranulesClient.get(granuleId);

  t.deepEqual(granulePgRecord.error, updatedError);
  t.deepEqual(esRecord.error, updatedError);
});

test.serial('writeGranuleFromApi() overwrites granule record with status "completed" with files set to null with file value set to undefined/default in Elastic and "[]" in Postgres', async (t) => {
  const {
    esClient,
    knex,
    collectionCumulusId,
    granule,
    granuleId,
    granulePgModel,
  } = t.context;

  const result = await writeGranuleFromApi(granule, knex, esClient, 'Create');
  t.is(result, `Wrote Granule ${granuleId}`);

  const updateResult = await writeGranuleFromApi({ ...granule, files: null, status: 'completed' }, knex, esClient, 'Create');
  t.is(updateResult, `Wrote Granule ${granuleId}`);

  const granulePgRecord = await granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );
  const esRecord = await t.context.esGranulesClient.get(granuleId);

  const translatedPgRecord = await translatePostgresGranuleToApiGranule({
    granulePgRecord,
    knexOrTransaction: knex,
  });

  t.deepEqual(translatedPgRecord.files, []);
  t.is(esRecord.files, undefined);
});

test.serial('writeGranuleFromApi() writes a new granule with files set to "[]" results in file value set to undefined/default in Elastic and "[]" in Postgres', async (t) => {
  const {
    esClient,
    knex,
    collectionCumulusId,
    granule,
    granuleId,
    granulePgModel,
  } = t.context;

  const updateResult = await writeGranuleFromApi({ ...granule, files: [] }, knex, esClient, 'Create');
  t.is(updateResult, `Wrote Granule ${granuleId}`);

  const granulePgRecord = await granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );
  const esRecord = await t.context.esGranulesClient.get(granuleId);

  const translatedPgRecord = await translatePostgresGranuleToApiGranule({
    granulePgRecord,
    knexOrTransaction: knex,
  });

  t.deepEqual(translatedPgRecord.files, []);
  t.is(esRecord.files, undefined);
});

test.serial('writeGranuleFromApi() overwrites granule record with status "failed" with files set to null with file value set to undefined/default in Elastic and "[]" in Postgres', async (t) => {
  const {
    esClient,
    knex,
    collectionCumulusId,
    granule,
    granuleId,
    granulePgModel,
  } = t.context;

  const result = await writeGranuleFromApi(granule, knex, esClient, 'Create');
  t.is(result, `Wrote Granule ${granuleId}`);

  const updateResult = await writeGranuleFromApi({ ...granule, files: null, status: 'failed' }, knex, esClient, 'Create');
  t.is(updateResult, `Wrote Granule ${granuleId}`);

  const granulePgRecord = await granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );
  const esRecord = await t.context.esGranulesClient.get(granuleId);

  const translatedPgRecord = await translatePostgresGranuleToApiGranule({
    granulePgRecord,
    knexOrTransaction: knex,
  });

  t.deepEqual(translatedPgRecord.files, []);
  t.is(esRecord.files, undefined);
});

test.serial('writeGranuleFromApi() overwrites granule record with status "running" with files set to null with file value set to undefined/default in Elastic and "[]" in Postgres', async (t) => {
  const {
    esClient,
    knex,
    collectionCumulusId,
    granule,
    granuleId,
    granulePgModel,
  } = t.context;

  const result = await writeGranuleFromApi(granule, knex, esClient, 'Create');
  t.is(result, `Wrote Granule ${granuleId}`);

  const updateResult = await writeGranuleFromApi({ ...granule, files: null, status: 'running' }, knex, esClient, 'Create');
  t.is(updateResult, `Wrote Granule ${granuleId}`);

  const granulePgRecord = await granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );
  const esRecord = await t.context.esGranulesClient.get(granuleId);

  const translatedPgRecord = await translatePostgresGranuleToApiGranule({
    granulePgRecord,
    knexOrTransaction: knex,
  });

  t.deepEqual(translatedPgRecord.files, []);
  t.is(esRecord.files, undefined);
});

test.serial('writeGranuleFromApi() overwrites granule record with status "queued" with files set to null with file value set to undefined/default in Elastic and "[]" in Postgres', async (t) => {
  const {
    esClient,
    knex,
    collectionCumulusId,
    granule,
    granuleId,
    granulePgModel,
  } = t.context;

  const result = await writeGranuleFromApi(granule, knex, esClient, 'Create');
  t.is(result, `Wrote Granule ${granuleId}`);

  const updateResult = await writeGranuleFromApi({ ...granule, files: null, status: 'queued' }, knex, esClient, 'Create');
  t.is(updateResult, `Wrote Granule ${granuleId}`);

  const granulePgRecord = await granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );
  const esRecord = await t.context.esGranulesClient.get(granuleId);

  const translatedPgRecord = await translatePostgresGranuleToApiGranule({
    granulePgRecord,
    knexOrTransaction: knex,
  });

  t.deepEqual(translatedPgRecord.files, []);
  t.is(esRecord.files, undefined);
});

test.serial('writeGranuleFromApi() overwrites granule record on overwrite with files set to all datastores', async (t) => {
  const {
    esClient,
    knex,
    collectionCumulusId,
    granule,
    granuleId,
    granulePgModel,
  } = t.context;

  const result = await writeGranuleFromApi({ ...granule, files: null }, knex, esClient, 'Create');
  t.is(result, `Wrote Granule ${granuleId}`);

  const updateResult = await writeGranuleFromApi(granule, knex, esClient, 'Create');
  t.is(updateResult, `Wrote Granule ${granuleId}`);

  const granulePgRecord = await granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );
  const esRecord = await t.context.esGranulesClient.get(granuleId);

  const translatedPgRecord = await translatePostgresGranuleToApiGranule({
    granulePgRecord,
    knexOrTransaction: knex,
  });

  [esRecord, granule, translatedPgRecord].forEach((record) => {
    record.files.sort((f1, f2) => sortFilesByBuckets(f1, f2));
  });

  t.deepEqual(translatedPgRecord.files, granule.files);
  t.deepEqual(esRecord.files, granule.files);
});

test.serial('writeGranuleFromApi() overwrites granule with expected nullified values for all states', async (t) => {
  const {
    esClient,
    knex,
    collectionCumulusId,
    granule,
    granuleId,
    granulePgModel,
  } = t.context;

  const result = await writeGranuleFromApi(granule, knex, esClient, 'Create');
  t.is(result, `Wrote Granule ${granuleId}`);

  const updateResult = await writeGranuleFromApi({ ...granule, files: null, status: 'completed' }, knex, esClient, 'Create');
  t.is(updateResult, `Wrote Granule ${granuleId}`);

  const granulePgRecord = await granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );
  const esRecord = await t.context.esGranulesClient.get(granuleId);

  const translatedPgRecord = await translatePostgresGranuleToApiGranule({
    granulePgRecord,
    knexOrTransaction: knex,
  });

  t.deepEqual(translatedPgRecord.files, []);
  t.is(esRecord.files, undefined);
});
