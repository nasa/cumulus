'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const sinon = require('sinon');
const sortBy = require('lodash/sortBy');
const omit = require('lodash/omit');

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
  fakeCollectionRecordFactory,
  fakeExecutionRecordFactory,
  fakeFileRecordFactory,
  fakeGranuleRecordFactory,
  fakeProviderRecordFactory,
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
const Granule = require('../../../models/granules');

/**
 * Helper function for updating an existing granule with a static payload and validating
 *
 * @param {Object} t -- Used for the test context
 * @param {boolean} writeFromMessage -- Calls writeGranulesFromMessage function if true,
 *   writeGranuleFromApi otherwise
 * @returns {Object} -- Updated granule objects from each datastore and PG-translated payload
 *   updatedPgGranuleFields,
 *   pgGranule,
 *   esGranule,
 *   dynamoGranule,
 **/
const updateGranule = async (t, writeFromMessage = false) => {
  const {
    collectionCumulusId,
    esClient,
    esGranulesClient,
    executionCumulusId,
    granule,
    granuleId,
    granuleModel,
    granulePgModel,
    providerCumulusId,
    knex,
  } = t.context;

  // Update existing granule with a partial granule object
  const updateGranulePayload = {
    granuleId,
    collectionId: granule.collectionId,
    cmrLink: 'updatedGranuled.com', // Only field we're changing
    // FUTURE: In order to update a granule, the payload must include status and
    // the status must be 'completed' or 'failed'
    // if it's running or queued, it will try to insert the granule, not upsert
    status: granule.status,
  };

  if (writeFromMessage) {
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
      },
    };

    await writeGranulesFromMessage({
      cumulusMessage: updatedCumulusMessage,
      executionCumulusId,
      providerCumulusId,
      knex,
      granuleModel,
    });
  } else {
    await writeGranuleFromApi({ ...updateGranulePayload }, knex, esClient, 'Update');
  }

  const dynamoGranule = await granuleModel.get({ granuleId });
  const pgGranule = await granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );
  const esGranule = await esGranulesClient.get(granuleId);

  // Updates were applied to all datastores
  t.is(pgGranule.cmr_link, updateGranulePayload.cmrLink);
  t.is(dynamoGranule.cmrLink, updateGranulePayload.cmrLink);
  t.is(esGranule.cmrLink, updateGranulePayload.cmrLink);

  const updatedPgGranuleFields = await translateApiGranuleToPostgresGranule(
    { ...updateGranulePayload },
    knex
  );

  return {
    updatedPgGranuleFields,
    pgGranule,
    esGranule,
    dynamoGranule,
  };
};

test.before(async (t) => {
  process.env.GranulesTable = `write-granules-${cryptoRandomString({ length: 10 })}`;

  const fakeFileUtils = {
    buildDatabaseFiles: (params) => Promise.resolve(params.files),
  };
  const fakeStepFunctionUtils = {
    describeExecution: () => Promise.resolve({}),
  };
  const granuleModel = new Granule({
    fileUtils: fakeFileUtils,
    stepFunctionUtils: fakeStepFunctionUtils,
  });
  await granuleModel.createTable();
  t.context.granuleModel = granuleModel;

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

  const stateMachineName = cryptoRandomString({ length: 5 });
  t.context.stateMachineArn = `arn:aws:states:us-east-1:12345:stateMachine:${stateMachineName}`;

  t.context.executionName = cryptoRandomString({ length: 5 });
  t.context.executionArn = `arn:aws:states:us-east-1:12345:execution:${stateMachineName}:${t.context.executionName}`;
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
  t.context.granule = fakeGranuleFactoryV2({
    files: t.context.files,
    granuleId: t.context.granuleId,
    collectionId: constructCollectionId(t.context.collection.name, t.context.collection.version),
    execution: execution.url,
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
    },
  };

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

  [t.context.providerCumulusId] = await t.context.providerPgModel.create(
    t.context.knex,
    t.context.provider
  );
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
  const {
    granuleModel,
  } = t.context;
  await granuleModel.deleteTable();
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
    knex,
    granuleModel,
    granuleId,
    collectionCumulusId,
    executionUrl,
  } = t.context;

  const apiGranuleRecord = {
    ...granule,
    status: 'completed',
  };
  const postgresGranuleRecord = await translateApiGranuleToPostgresGranule(
    apiGranuleRecord,
    knex
  );
  await _writeGranule({
    apiGranuleRecord,
    postgresGranuleRecord,
    executionCumulusId,
    granuleModel,
    knex,
    esClient,
    snsEventType: 'Update',
  });

  t.like(
    await granuleModel.get({ granuleId }),
    {
      execution: executionUrl,
      status: 'completed',
    }
  );
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

  let updatedPgGranuleRecord = await translateApiGranuleToPostgresGranule(
    updatedapiGranuleRecord,
    knex
  );

  updatedPgGranuleRecord = {
    ...updatedPgGranuleRecord,
    cumulus_id: granulePgRecord.cumulus_id,
  };

  await _writeGranule({
    apiGranuleRecord: updatedapiGranuleRecord,
    postgresGranuleRecord: updatedPgGranuleRecord,
    executionCumulusId,
    granuleModel,
    knex,
    esClient,
    snsEventType: 'Update',
  });

  t.like(
    await granuleModel.get({ granuleId }),
    {
      execution: executionUrl,
      status: 'completed',
    }
  );
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
    granuleModel,
  } = t.context;
  const cumulusMessage = {};
  const actual = await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    granuleModel,
  });
  t.is(actual, undefined);
});

test.serial('writeGranulesFromMessage() returns undefined if message has empty granule set', async (t) => {
  const {
    knex,
    executionCumulusId,
    providerCumulusId,
    granuleModel,
  } = t.context;
  const cumulusMessage = { granules: [] };
  const actual = await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    granuleModel,
  });
  t.is(actual, undefined);
});

test.serial('writeGranulesFromMessage() saves granule records to DynamoDB/PostgreSQL/Elasticsearch/SNS if PostgreSQL write is enabled', async (t) => {
  const {
    cumulusMessage,
    granuleModel,
    knex,
    collectionCumulusId,
    executionCumulusId,
    providerCumulusId,
    granuleId,
  } = t.context;

  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    granuleModel,
  });

  t.true(await granuleModel.exists({ granuleId }));
  t.true(await t.context.granulePgModel.exists(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  ));
  t.true(await t.context.esGranulesClient.exists(granuleId));

  const { Messages } = await sqs().receiveMessage({
    QueueUrl: t.context.QueueUrl,
    WaitTimeSeconds: 10,
  }).promise();
  t.is(Messages.length, 1);
});

test.serial('writeGranulesFromMessage() saves the same values to DynamoDB, PostgreSQL and Elasticsearch', async (t) => {
  const {
    collectionCumulusId,
    cumulusMessage,
    granuleModel,
    knex,
    executionCumulusId,
    providerCumulusId,
    granuleId,
  } = t.context;

  // Only test fields that are stored in Postgres on the Granule record.
  // The following fields are populated by separate queries during translation
  // or elasticsearch.
  const omitList = ['files', 'execution', 'pdrName', 'provider', '_id'];

  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    granuleModel,
  });

  const dynamoRecord = await granuleModel.get({ granuleId });
  const granulePgRecord = await t.context.granulePgModel.get(
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
  t.deepEqual(omit(translatedPgRecord, omitList), omit(dynamoRecord, omitList));

  const esRecord = await t.context.esGranulesClient.get(granuleId);
  t.deepEqual(omit(translatedPgRecord, omitList), omit(esRecord, omitList));
});

test.serial('writeGranulesFromMessage() given a partial granule updates only provided fields', async (t) => {
  const {
    collectionCumulusId,
    cumulusMessage,
    esGranulesClient,
    granuleModel,
    granulePgModel,
    knex,
    executionCumulusId,
    providerCumulusId,
    granuleId,
  } = t.context;

  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    granuleModel,
  });

  t.true(await granuleModel.exists({ granuleId }));
  t.true(await granulePgModel.exists(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  ));
  t.true(await esGranulesClient.exists(granuleId));

  const originalpgGranule = await granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );

  const { updatedPgGranuleFields, pgGranule } = await updateGranule(t, true);

  // FUTURE:
  // 1. 'created_at' is updated during PUT/PATCH
  // 2. 'published' defaults to false if not provided in the payload
  // 3. 'duration' comes from the workflow and will be reset on update
  // 4. 'product_volume' comes from a files object on the payload, which may not exist
  //   in the case of partial granule updates
  const omitList = [
    'cumulus_id',
    'updated_at',
    'created_at',
    'published',
    'timestamp',
    'duration',
    'product_volume',
  ];

  // Postgres granule matches expected updatedGranule
  t.deepEqual(
    omit(removeNilProperties(pgGranule), omitList),
    omit(removeNilProperties({ ...originalpgGranule, ...updatedPgGranuleFields }), omitList)
  );
});

test.serial('writeGranulesFromMessage() given a partial granule updates all datastores with the same data', async (t) => {
  const {
    collectionCumulusId,
    cumulusMessage,
    esGranulesClient,
    granuleModel,
    granulePgModel,
    knex,
    executionCumulusId,
    providerCumulusId,
    granuleId,
  } = t.context;

  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    granuleModel,
  });

  t.true(await granuleModel.exists({ granuleId }));
  t.true(await granulePgModel.exists(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  ));
  t.true(await esGranulesClient.exists(granuleId));

  const { esGranule, dynamoGranule, pgGranule } = await updateGranule(t, true);

  // Postgres and ElasticSearch granules matches
  t.deepEqual(
    omit(removeNilProperties(pgGranule), ['cumulus_id']),
    await translateApiGranuleToPostgresGranule(esGranule, knex)
  );

  // Postgres and Dynamo granules matches
  t.deepEqual(
    omit(removeNilProperties(pgGranule), ['cumulus_id']),
    await translateApiGranuleToPostgresGranule(dynamoGranule, knex)
  );
});

test.serial('writeGranulesFromMessage() removes preexisting granule file from postgres on granule update with disjoint files', async (t) => {
  const {
    cumulusMessage,
    filePgModel,
    granule,
    granuleModel,
    granulePgModel,
    knex,
    executionCumulusId,
    providerCumulusId,
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
  const existingPgGranule = await translateApiGranuleToPostgresGranule(existingGranule, knex);
  const [existingPgGranuleRecordId] = await granulePgModel.create(knex, existingPgGranule, '*');

  await Promise.all(files.map(async (file) => {
    const pgFile = await translateApiFiletoPostgresFile(file);
    pgFile.granule_cumulus_id = existingPgGranuleRecordId.cumulus_id;
    return filePgModel.create(knex, pgFile);
  }));
  const existingPgFiles = await filePgModel.search(knex, {});

  // Create the message granule and associated file in PG.
  // The fakeFile created here is NOT in the message and will be deleted
  // in writeGranulesFromMessage
  const pgGranule = await translateApiGranuleToPostgresGranule(granule, knex);
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
    providerCumulusId,
    knex,
    granuleModel,
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
    existingPgFiles.map((file) => file.bucket).concat(filesFromCumulusMessage),
    updatedPgFiles.map((file) => file.bucket)
  );
});

test.serial('writeGranulesFromMessage() saves granule records to Dynamo/PostgreSQL/Elasticsearch with same created at, updated at and timestamp values', async (t) => {
  const {
    cumulusMessage,
    granuleModel,
    knex,
    collectionCumulusId,
    executionCumulusId,
    providerCumulusId,
    granuleId,
  } = t.context;

  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    granuleModel,
  });

  const dynamoRecord = await granuleModel.get({ granuleId });
  const granulePgRecord = await t.context.granulePgModel.get(
    knex,
    {
      granule_id: granuleId,
      collection_cumulus_id: collectionCumulusId,
    }
  );

  const esRecord = await t.context.esGranulesClient.get(granuleId);

  t.truthy(dynamoRecord.timestamp);
  t.is(granulePgRecord.timestamp.getTime(), dynamoRecord.timestamp);
  t.is(granulePgRecord.created_at.getTime(), dynamoRecord.createdAt);
  t.is(granulePgRecord.updated_at.getTime(), dynamoRecord.updatedAt);

  t.is(granulePgRecord.created_at.getTime(), esRecord.createdAt);
  t.is(granulePgRecord.updated_at.getTime(), esRecord.updatedAt);
  t.is(granulePgRecord.timestamp.getTime(), esRecord.timestamp);
});

test.serial('writeGranulesFromMessage() saves the same files to DynamoDB, PostgreSQL and Elasticsearch', async (t) => {
  const {
    collectionCumulusId,
    cumulusMessage,
    esGranulesClient,
    executionCumulusId,
    granuleId,
    granuleModel,
    granulePgModel,
    knex,
    providerCumulusId,
  } = t.context;

  // ensure files are written
  cumulusMessage.meta.status = 'completed';

  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    granuleModel,
  });

  const dynamoRecord = await granuleModel.get({ granuleId });
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
  t.deepEqual(sortBy(translatedPgRecord.files, sortByKeys), sortBy(dynamoRecord.files, sortByKeys));

  const esRecord = await esGranulesClient.get(granuleId);
  t.deepEqual(sortBy(translatedPgRecord.files, sortByKeys), sortBy(esRecord.files, sortByKeys));
});

test.serial('writeGranulesFromMessage() saves file records to DynamoDB/PostgreSQL if Postgres write is enabled and workflow status is "completed"', async (t) => {
  const {
    collectionCumulusId,
    cumulusMessage,
    executionCumulusId,
    filePgModel,
    granuleId,
    granuleModel,
    granulePgModel,
    knex,
    providerCumulusId,
    files,
  } = t.context;

  cumulusMessage.meta.status = 'completed';

  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    granuleModel,
  });

  const dynamoGranule = await granuleModel.get({ granuleId });
  t.deepEqual(dynamoGranule.files, files);

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

test.serial('writeGranulesFromMessage() does not persist file records to Postgres if the workflow status is "running"', async (t) => {
  const {
    collectionCumulusId,
    cumulusMessage,
    executionCumulusId,
    filePgModel,
    granuleId,
    granuleModel,
    granulePgModel,
    knex,
    providerCumulusId,
  } = t.context;

  cumulusMessage.meta.status = 'running';

  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    granuleModel,
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

test.serial('writeGranulesFromMessage() handles successful and failing writes independently', async (t) => {
  const {
    cumulusMessage,
    granuleModel,
    knex,
    collectionCumulusId,
    executionCumulusId,
    providerCumulusId,
    granuleId,
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
    providerCumulusId,
    knex,
    granuleModel,
  }));

  t.true(await granuleModel.exists({ granuleId }));
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
    granuleModel,
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
    granuleModel,
  }));
});

test.serial('writeGranulesFromMessage() does not write to DynamoDB/PostgreSQL/Elasticsearch/SNS if Dynamo write fails', async (t) => {
  const {
    cumulusMessage,
    granuleModel,
    knex,
    collectionCumulusId,
    executionCumulusId,
    providerCumulusId,
    granuleId,
  } = t.context;

  const fakeGranuleModel = {
    generateGranuleRecord: () => t.context.granule,
    storeGranule: () => {
      throw new Error('Granules dynamo error');
    },
    describeGranuleExecution: () => Promise.resolve({}),
    delete: () => Promise.resolve(),
    exists: () => Promise.resolve(false),
  };

  const [error] = await t.throwsAsync(
    writeGranulesFromMessage({
      cumulusMessage,
      executionCumulusId,
      providerCumulusId,
      knex,
      granuleModel: fakeGranuleModel,
    })
  );

  t.true(error.message.includes('Granules dynamo error'));
  t.false(await granuleModel.exists({ granuleId }));
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

test.serial('writeGranulesFromMessage() does not write to DynamoDB/PostgreSQL/Elasticsearch/SNS if Postgres write fails', async (t) => {
  const {
    cumulusMessage,
    granuleModel,
    knex,
    executionCumulusId,
    providerCumulusId,
    granuleId,
    collectionCumulusId,
  } = t.context;

  const testGranulePgModel = {
    upsert: () => {
      throw new Error('Granules PostgreSQL error');
    },
    exists: () => Promise.resolve(false),
  };

  const [error] = await t.throwsAsync(writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    granuleModel,
    granulePgModel: testGranulePgModel,
  }));

  t.true(error.message.includes('Granules PostgreSQL error'));
  t.false(await granuleModel.exists({ granuleId }));
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

test.serial('writeGranulesFromMessage() does not persist records to DynamoDB/PostgreSQL/Elasticsearch/SNS if Elasticsearch write fails', async (t) => {
  const {
    cumulusMessage,
    granuleModel,
    knex,
    collectionCumulusId,
    executionCumulusId,
    providerCumulusId,
    granuleId,
  } = t.context;

  const fakeEsClient = {
    update: () => {
      throw new Error('Granules ES error');
    },
    delete: () => Promise.resolve(),
  };

  const [error] = await t.throwsAsync(writeGranulesFromMessage({
    cumulusMessage,
    collectionCumulusId,
    executionCumulusId,
    providerCumulusId,
    knex,
    granuleModel,
    esClient: fakeEsClient,
  }));

  t.true(error.message.includes('Granules ES error'));
  t.false(await granuleModel.exists({ granuleId }));
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
    granuleModel,
    granuleId,
  } = t.context;

  cumulusMessage.meta.status = 'completed';

  cumulusMessage.payload.granules[0].files[0].bucket = undefined;
  cumulusMessage.payload.granules[0].files[0].key = undefined;

  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    granuleModel,
  });

  const dynamoGranule = await granuleModel.get({ granuleId });
  const dynamoGranuleError = JSON.parse(dynamoGranule.error.errors);
  t.is(dynamoGranule.status, 'failed');
  t.deepEqual(dynamoGranuleError.map((error) => error.Error), ['Failed writing files to PostgreSQL.']);
  t.true(dynamoGranuleError[0].Cause.includes('AggregateError'));

  const pgGranule = await t.context.granulePgModel.get(knex, {
    granule_id: granuleId,
    collection_cumulus_id: collectionCumulusId,
  });
  t.is(pgGranule.status, 'failed');
  const pgGranuleError = JSON.parse(pgGranule.error.errors);
  t.deepEqual(pgGranuleError.map((error) => error.Error), ['Failed writing files to PostgreSQL.']);
  t.true(pgGranuleError[0].Cause.includes('AggregateError'));
});

test.serial('_writeGranules attempts to mark granule as failed if a SchemaValidationException occurs when a granule is in a final state', async (t) => {
  const {
    cumulusMessage,
    knex,
    collectionCumulusId,
    executionCumulusId,
    providerCumulusId,
    granuleModel,
    granuleId,
  } = t.context;

  cumulusMessage.meta.status = 'queued';

  // iniital write
  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    granuleModel,
  });

  const originalError = { Error: 'Original Error', Cause: { Error: 'Original Error Cause' } };
  // second write
  // Invalid granule schema to prevent granule write to dynamo from succeeding
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
    granuleModel,
  }));

  t.true(error.message.includes('The record has validation errors:'));
  const dynamoGranule = await granuleModel.get({ granuleId });
  t.is(dynamoGranule.status, 'failed');
  const dynamoErrors = JSON.parse(dynamoGranule.error.errors);
  t.true(dynamoErrors[0].Cause.Error.includes(originalError.Cause.Error));

  const pgGranule = await t.context.granulePgModel.get(knex, {
    granule_id: granuleId,
    collection_cumulus_id: collectionCumulusId,
  });
  t.is(pgGranule.status, 'failed');
});

test.serial('writeGranulesFromMessage() writes all valid files if any non-valid file fails', async (t) => {
  const {
    cumulusMessage,
    knex,
    executionCumulusId,
    providerCumulusId,
    granuleModel,
    filePgModel,
    granulePgModel,
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
    granuleModel,
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
    cumulusMessage,
    knex,
    collectionCumulusId,
    executionCumulusId,
    providerCumulusId,
    granuleId,
    granuleModel,
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
    granuleModel,
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
    cumulusMessage,
    knex,
    collectionCumulusId,
    executionCumulusId,
    providerCumulusId,
    granuleModel,
    granuleId,
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
    granuleModel,
  });

  const dynamoGranule = await granuleModel.get({ granuleId });
  const dynamoGranuleErrors = JSON.parse(dynamoGranule.error.errors);
  t.is(dynamoGranule.status, 'failed');
  t.deepEqual(dynamoGranuleErrors.map((error) => error.Error), ['Unknown error', 'Failed writing files to PostgreSQL.']);
  t.deepEqual(dynamoGranuleErrors[0].Cause, { Error: 'Workflow failed' });

  const pgGranule = await t.context.granulePgModel.get(knex, {
    granule_id: granuleId,
    collection_cumulus_id: collectionCumulusId,
  });
  t.is(pgGranule.status, 'failed');
  const pgGranuleErrors = JSON.parse(pgGranule.error.errors);
  t.deepEqual(pgGranuleErrors.map((error) => error.Error), ['Unknown error', 'Failed writing files to PostgreSQL.']);
  t.deepEqual(pgGranuleErrors[0].Cause, { Error: 'Workflow failed' });
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
  const pgGranule = await translateApiGranuleToPostgresGranule(granule, knex);
  const returnedGranule = await granulePgModel.create(knex, pgGranule, '*');

  const fakeFile = await filePgModel.create(knex, {
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

test.serial('writeGranulesFromMessage() honors granule.createdAt time if provided in cumulus_message', async (t) => {
  const {
    cumulusMessage,
    knex,
    collectionCumulusId,
    executionCumulusId,
    providerCumulusId,
    granuleId,
    granuleModel,
  } = t.context;

  const expectedCreatedAt = Date.now();

  cumulusMessage.payload.granules[0].createdAt = expectedCreatedAt;

  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    granuleModel,
  });

  const dynamoGranule = await granuleModel.get({ granuleId });
  t.is(dynamoGranule.createdAt, expectedCreatedAt);

  const pgGranule = await t.context.granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );
  t.is(pgGranule.created_at.getTime(), expectedCreatedAt);
});

test.serial('writeGranulesFromMessage() falls back to workflow_start_time if granule.createdAt is not provided in cumulus_message', async (t) => {
  const {
    cumulusMessage,
    knex,
    collectionCumulusId,
    executionCumulusId,
    providerCumulusId,
    granuleId,
    granuleModel,
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
    granuleModel,
  });

  const dynamoGranule = await granuleModel.get({ granuleId });
  t.is(dynamoGranule.createdAt, cumulusMessage.cumulus_meta.workflow_start_time);

  const pgGranule = await t.context.granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );
  t.is(pgGranule.created_at.getTime(), expectedCreatedAt);
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

test.serial('writeGranuleFromApi() writes a granule to PostgreSQL, DynamoDB, and Elasticsearch.', async (t) => {
  const {
    collectionCumulusId,
    esClient,
    esGranulesClient,
    granule,
    granuleId,
    granuleModel,
    granulePgModel,
    knex,
  } = t.context;

  const result = await writeGranuleFromApi({ ...granule }, knex, esClient, 'Create');

  t.is(result, `Wrote Granule ${granuleId}`);

  t.true(await granuleModel.exists({ granuleId }));
  t.true(await granulePgModel.exists(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  ));
  t.true(await esGranulesClient.exists(granuleId));
});

test.serial('writeGranuleFromApi() given a partial granule updates only provided fields', async (t) => {
  const {
    collectionCumulusId,
    esClient,
    esGranulesClient,
    granule,
    granuleId,
    granuleModel,
    granulePgModel,
    knex,
  } = t.context;

  await writeGranuleFromApi({ ...granule }, knex, esClient, 'Create');

  t.true(await granuleModel.exists({ granuleId }));
  t.true(await granulePgModel.exists(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  ));
  t.true(await esGranulesClient.exists(granuleId));

  const originalpgGranule = await granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );

  const { updatedPgGranuleFields, pgGranule } = await updateGranule(t);

  // FUTURE:
  // 1. 'created_at' is updated during PUT/PATCH
  // 2. 'published' defaults to false if not provided in the payload
  const omitList = ['cumulus_id', 'updated_at', 'created_at', 'published', 'timestamp'];

  // Postgres granule matches expected updatedGranule
  t.deepEqual(
    omit(removeNilProperties(pgGranule), omitList),
    omit(removeNilProperties({ ...originalpgGranule, ...updatedPgGranuleFields }), omitList)
  );
});

test.serial('writeGranuleFromApi() given a partial granule updates all datastores with the same data', async (t) => {
  const {
    collectionCumulusId,
    esClient,
    esGranulesClient,
    granule,
    granuleId,
    granuleModel,
    granulePgModel,
    knex,
  } = t.context;

  await writeGranuleFromApi({ ...granule }, knex, esClient, 'Create');

  t.true(await granuleModel.exists({ granuleId }));
  t.true(await granulePgModel.exists(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  ));
  t.true(await esGranulesClient.exists(granuleId));

  const { esGranule, dynamoGranule, pgGranule } = await updateGranule(t);

  // Postgres and ElasticSearch granules matches
  t.deepEqual(
    omit(removeNilProperties(pgGranule), ['cumulus_id']),
    await translateApiGranuleToPostgresGranule(esGranule, knex)
  );

  // Postgres and Dynamo granules matches
  t.deepEqual(
    omit(removeNilProperties(pgGranule), ['cumulus_id']),
    await translateApiGranuleToPostgresGranule(dynamoGranule, knex)
  );
});

test.serial('writeGranuleFromApi() writes a full granule without an execution to PostgreSQL and DynamoDB.', async (t) => {
  const {
    collectionCumulusId,
    esClient,
    granule,
    granuleId,
    granuleModel,
    granulePgModel,
    knex,
  } = t.context;

  await writeGranuleFromApi({ ...granule, execution: undefined }, knex, esClient, 'Create');

  t.true(await granuleModel.exists({ granuleId }));
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
    granuleModel,
    granulePgModel,
    collectionCumulusId,
  } = t.context;

  await writeGranuleFromApi({ ...granule, files: [] }, knex, esClient, 'Create');
  t.true(await granuleModel.exists({ granuleId }));
  t.true(await granulePgModel.exists(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  ));
});

test.serial('writeGranuleFromApi() throws with granule with an execution url that does not exist.', async (t) => {
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

test.serial('writeGranuleFromApi() saves granule records to Dynamo, Postgres and ElasticSearch with same input time values.', async (t) => {
  const {
    esClient,
    knex,
    collectionCumulusId,
    granule,
    granuleId,
    granuleModel,
    granulePgModel,
  } = t.context;

  const createdAt = Date.now() - 24 * 60 * 60 * 1000;
  const updatedAt = Date.now() - 100000;
  const timestamp = Date.now();

  const result = await writeGranuleFromApi({ ...granule, createdAt, updatedAt, timestamp }, knex, esClient, 'Create');

  t.is(result, `Wrote Granule ${granuleId}`);

  const dynamoRecord = await granuleModel.get({ granuleId });
  const postgresRecord = await granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );
  const esRecord = await t.context.esGranulesClient.get(granuleId);

  t.truthy(dynamoRecord.timestamp);
  t.is(postgresRecord.created_at.getTime(), dynamoRecord.createdAt);
  t.is(postgresRecord.updated_at.getTime(), dynamoRecord.updatedAt);
  t.is(postgresRecord.timestamp.getTime(), dynamoRecord.timestamp);

  t.is(postgresRecord.created_at.getTime(), esRecord.createdAt);
  t.is(postgresRecord.updated_at.getTime(), esRecord.updatedAt);
  t.is(postgresRecord.timestamp.getTime(), esRecord.timestamp);
});

test.serial('writeGranuleFromApi() saves granule records to Dynamo, Postgres and ElasticSearch with same default time values.', async (t) => {
  const {
    esClient,
    knex,
    collectionCumulusId,
    granule,
    granuleId,
    granuleModel,
    granulePgModel,
  } = t.context;

  const createdAt = undefined;
  const updatedAt = undefined;
  const timestamp = undefined;

  const result = await writeGranuleFromApi({ ...granule, createdAt, updatedAt, timestamp }, knex, esClient, 'Create');

  t.is(result, `Wrote Granule ${granuleId}`);

  const dynamoRecord = await granuleModel.get({ granuleId });
  const postgresRecord = await granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );
  const esRecord = await t.context.esGranulesClient.get(granuleId);

  t.truthy(dynamoRecord.timestamp);
  t.is(postgresRecord.created_at.getTime(), dynamoRecord.createdAt);
  t.is(postgresRecord.updated_at.getTime(), dynamoRecord.updatedAt);
  t.is(postgresRecord.timestamp.getTime(), dynamoRecord.timestamp);
  t.is(postgresRecord.timestamp.getTime(), dynamoRecord.updatedAt);

  t.is(postgresRecord.created_at.getTime(), esRecord.createdAt);
  t.is(postgresRecord.updated_at.getTime(), esRecord.updatedAt);
  t.is(postgresRecord.timestamp.getTime(), esRecord.timestamp);
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

test.serial('writeGranuleFromApi() does not persist file records to Postgres if workflow status is "running"', async (t) => {
  const {
    collectionCumulusId,
    esClient,
    filePgModel,
    granule,
    granuleId,
    granulePgModel,
    knex,
  } = t.context;

  await writeGranuleFromApi({ ...granule, status: 'running' }, knex, esClient, 'Create');

  const granuleRecord = await granulePgModel.get(
    knex,
    {
      granule_id: granuleId,
      collection_cumulus_id: collectionCumulusId,
    }
  );

  t.false(
    await filePgModel.exists(knex, { granule_cumulus_id: granuleRecord.cumulus_id })
  );
});

test.serial('writeGranuleFromApi() does not persist records to Dynamo or Postgres if Dynamo write fails', async (t) => {
  const {
    collectionCumulusId,
    esClient,
    granule,
    granuleId,
    granuleModel,
    knex,
  } = t.context;

  const fakeGranuleModel = {
    storeGranule: () => {
      throw new Error('Granules dynamo error');
    },
    delete: () => Promise.resolve({}),
    describeGranuleExecution: () => Promise.resolve({}),
    exists: () => Promise.resolve(false),
  };

  const error = await t.throwsAsync(
    writeGranuleFromApi({ ...granule, granuleModel: fakeGranuleModel }, knex, esClient, 'Create')
  );

  t.true(error.message.includes('Granules dynamo error'));
  t.false(await granuleModel.exists({ granuleId }));
  t.false(
    await t.context.granulePgModel.exists(
      knex,
      { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
    )
  );
});

test.serial('writeGranuleFromApi() does not persist records to Dynamo or Postgres if Postgres write fails', async (t) => {
  const {
    collectionCumulusId,
    esClient,
    granule,
    granuleModel,
    knex,
    granuleId,
  } = t.context;

  const testGranulePgModel = {
    upsert: () => {
      throw new Error('Granules Postgres error');
    },
    exists: () => Promise.resolve(false),
  };

  const error = await t.throwsAsync(writeGranuleFromApi(
    { ...granule, granulePgModel: testGranulePgModel },
    knex,
    esClient,
    'Create'
  ));
  t.true(error.message.includes('Granules Postgres error'));
  t.false(await granuleModel.exists({ granuleId }));
  t.false(
    await t.context.granulePgModel.exists(
      knex,
      { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
    )
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

test.serial('updateGranuleStatusToQueued() updates granule status in DynamoDB/PostgreSQL/Elasticsearch and publishes SNS message', async (t) => {
  const {
    collectionCumulusId,
    esGranulesClient,
    esClient,
    granule,
    granuleId,
    granuleModel,
    granulePgModel,
    knex,
    QueueUrl,
  } = t.context;

  await writeGranuleFromApi({ ...granule }, knex, esClient, 'Create');
  const dynamoRecord = await granuleModel.get({ granuleId });
  const postgresRecord = await granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );
  const esRecord = await esGranulesClient.get(granuleId, granule.collectionId);

  await updateGranuleStatusToQueued({
    granule: dynamoRecord,
    knex,
  });

  const updatedDynamoRecord = await granuleModel.get({ granuleId });
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

  t.is(updatedDynamoRecord.status, 'queued');
  t.is(updatedPostgresRecord.status, 'queued');
  t.is(updatedEsRecord.status, 'queued');
  t.is(updatedDynamoRecord.execution, undefined);
  t.deepEqual(omit(dynamoRecord, omitList), omit(updatedDynamoRecord, omitList));
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
    updateGranuleStatusToQueued({ granule: badGranule, knex }),
    {
      name: 'RecordDoesNotExist',
      message: `Record in collections with identifiers {"name":"${name}","version":"${version}"} does not exist.`,
    }
  );
});

test.serial('updateGranuleStatusToQueued() does not update DynamoDB or Elasticsearch granule if writing to PostgreSQL fails', async (t) => {
  const {
    collectionCumulusId,
    esGranulesClient,
    esClient,
    granule,
    granuleId,
    granuleModel,
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
  const dynamoRecord = await granuleModel.get({ granuleId });
  const postgresRecord = await granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );
  const esRecord = await esGranulesClient.get(granuleId, granule.collectionId);

  t.is(dynamoRecord.status, 'completed');
  t.is(postgresRecord.status, 'completed');
  t.is(esRecord.status, 'completed');
  t.truthy(dynamoRecord.execution);

  await t.throwsAsync(
    updateGranuleStatusToQueued({
      granule: dynamoRecord,
      knex,
      granulePgModel: testGranulePgModel,
    }),
    { message: 'Granules Postgres error' }
  );

  const updatedDynamoRecord = await granuleModel.get({ granuleId });
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

  t.not(updatedDynamoRecord.status, 'queued');
  t.not(updatedPostgresRecord.status, 'queued');
  t.not(esRecord.status, 'queued');
  t.not(updatedDynamoRecord.execution, undefined);
  // Check that granules are equal in all data stores
  t.deepEqual(omit(dynamoRecord, omitList), omit(updatedDynamoRecord, omitList));
  t.deepEqual(omit(postgresRecord, omitList), omit(updatedPostgresRecord, omitList));
  t.deepEqual(sortBy(translatedPgGranule.files, sortByKeys), sortBy(esRecord.files, sortByKeys));
  t.deepEqual(omit(esRecord, omitList), omit(updatedEsRecord, omitList));
  t.deepEqual(omit(translatedPgGranule, omitList), omit(esRecord, omitList));
});

test.serial('updateGranuleStatusToQueued() does not update DynamoDB or PostgreSQL granule if writing to Elasticsearch fails', async (t) => {
  const {
    collectionCumulusId,
    esGranulesClient,
    esClient,
    granule,
    granuleId,
    granuleModel,
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
  const dynamoRecord = await granuleModel.get({ granuleId });
  const postgresRecord = await granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );
  const esRecord = await esGranulesClient.get(granuleId, granule.collectionId);

  t.is(dynamoRecord.status, 'completed');
  t.is(postgresRecord.status, 'completed');
  t.is(esRecord.status, 'completed');
  t.truthy(dynamoRecord.execution);

  await t.throwsAsync(
    updateGranuleStatusToQueued({
      granule: dynamoRecord,
      knex,
      esClient: fakeEsClient,
    }),
    { message: 'Elasticsearch failure' }
  );

  const updatedDynamoRecord = await granuleModel.get({ granuleId });
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

  t.not(updatedDynamoRecord.status, 'queued');
  t.not(updatedPostgresRecord.status, 'queued');
  t.not(esRecord.status, 'queued');
  t.not(updatedDynamoRecord.execution, undefined);
  // Check that granules are equal in all data stores
  t.deepEqual(omit(dynamoRecord, omitList), omit(updatedDynamoRecord, omitList));
  t.deepEqual(omit(postgresRecord, omitList), omit(updatedPostgresRecord, omitList));
  t.deepEqual(sortBy(translatedPgGranule.files, sortByKeys), sortBy(esRecord.files, sortByKeys));
  t.deepEqual(omit(esRecord, omitList), omit(updatedEsRecord, omitList));
  t.deepEqual(omit(translatedPgGranule, omitList), omit(esRecord, omitList));
});

test.serial('updateGranuleStatusToQueued() does not update PostgreSQL or Elasticsearch granule if writing to DynamoDB fails', async (t) => {
  const {
    collectionCumulusId,
    esGranulesClient,
    esClient,
    granule,
    granuleId,
    granuleModel,
    granulePgModel,
    knex,
  } = t.context;

  const fakeGranuleModel = {
    create: () => Promise.resolve(granule),
    get: () => Promise.resolve(granule),
    update: () => {
      throw new Error('DynamoDB failure');
    },
  };

  await writeGranuleFromApi({ ...granule }, knex, esClient, 'Create');
  const dynamoRecord = await granuleModel.get({ granuleId });
  const postgresRecord = await granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );
  const esRecord = await esGranulesClient.get(granuleId, granule.collectionId);

  t.is(dynamoRecord.status, 'completed');
  t.is(postgresRecord.status, 'completed');
  t.is(esRecord.status, 'completed');
  t.truthy(dynamoRecord.execution);

  await t.throwsAsync(
    updateGranuleStatusToQueued({
      granule: dynamoRecord,
      knex,
      granuleModel: fakeGranuleModel,
    }),
    { message: 'DynamoDB failure' }
  );

  const updatedDynamoRecord = await granuleModel.get({ granuleId });
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

  t.not(updatedDynamoRecord.status, 'queued');
  t.not(updatedPostgresRecord.status, 'queued');
  t.not(esRecord.status, 'queued');
  t.not(updatedDynamoRecord.execution, undefined);
  // Check that granules are equal in all data stores
  t.deepEqual(omit(dynamoRecord, omitList), omit(updatedDynamoRecord, omitList));
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
    granuleModel,
    granuleId,
    QueueUrl,
  } = t.context;

  const apiGranuleRecord = {
    ...granule,
    status: 'completed',
  };
  const postgresGranuleRecord = await translateApiGranuleToPostgresGranule(
    apiGranuleRecord,
    knex
  );

  await _writeGranule({
    apiGranuleRecord,
    postgresGranuleRecord,
    executionCumulusId,
    granuleModel,
    knex,
    esClient,
    snsEventType: 'Update',
  });

  t.true(await granuleModel.exists({ granuleId }));
  t.true(await t.context.esGranulesClient.exists(granuleId));

  const retrievedPgGranule = await t.context.granulePgModel.get(knex, {
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
    granuleModel,
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
  const dynamoRecord = await granuleModel.get({ granuleId });
  const postgresRecord = await granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );
  t.not(dynamoRecord.status, 'failed');
  t.not(postgresRecord.status, 'failed');

  const fakeErrorObject = { Error: 'This is a fake error', Cause: { Error: 'caused by some fake issue' } };
  await updateGranuleStatusToFailed(
    { granule: dynamoRecord, knex, error: fakeErrorObject, fakeEsClient }
  );
  const updatedDynamoRecord = await granuleModel.get({ granuleId });
  const updatedPostgresRecord = await granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );
  t.is(updatedDynamoRecord.status, 'failed');
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
