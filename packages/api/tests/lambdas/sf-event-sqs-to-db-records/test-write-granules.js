'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const sinon = require('sinon');

const {
  tableNames,
  doesRecordExist,
  CollectionPgModel,
  ProviderPgModel,
  ExecutionPgModel,
  fakeCollectionRecordFactory,
  fakeExecutionRecordFactory,
  fakeFileRecordFactory,
  fakeGranuleRecordFactory,
  fakeProviderRecordFactory,
  generateLocalTestDb,
  destroyLocalTestDb,
} = require('@cumulus/db');

const {
  generateFileRecord,
  generateGranuleRecord,
  getGranuleCumulusIdFromQueryResultOrLookup,
  writeFilesViaTransaction,
  writeGranules,
} = require('../../../lambdas/sf-event-sqs-to-db-records/write-granules');

const { migrationDir } = require('../../../../../lambdas/db-migration');

const { fakeFileFactory, fakeGranuleFactoryV2 } = require('../../../lib/testUtils');
const Granule = require('../../../models/granules');

test.before(async (t) => {
  process.env.GranulesTable = cryptoRandomString({ length: 10 });

  const fakeFileUtils = {
    buildDatabaseFiles: async (params) => params.files,
  };
  const fakeStepFunctionUtils = {
    describeExecution: async () => ({}),
  };
  const granuleModel = new Granule({
    fileUtils: fakeFileUtils,
    stepFunctionUtils: fakeStepFunctionUtils,
  });
  await granuleModel.createTable();
  t.context.granuleModel = granuleModel;

  t.context.testDbName = `writeGranules_${cryptoRandomString({ length: 10 })}`;

  const { knexAdmin, knex } = await generateLocalTestDb(
    t.context.testDbName,
    migrationDir
  );
  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;
});

test.beforeEach(async (t) => {
  const stateMachineName = cryptoRandomString({ length: 5 });
  t.context.stateMachineArn = `arn:aws:states:us-east-1:12345:stateMachine:${stateMachineName}`;

  t.context.executionName = cryptoRandomString({ length: 5 });
  t.context.executionArn = `arn:aws:states:us-east-1:12345:execution:${stateMachineName}:${t.context.executionName}`;

  t.context.collection = fakeCollectionRecordFactory();
  t.context.provider = fakeProviderRecordFactory();

  t.context.granuleId = cryptoRandomString({ length: 10 });
  t.context.files = [fakeFileFactory({ size: 5 })];
  t.context.granule = fakeGranuleFactoryV2({
    files: t.context.files,
    granuleId: t.context.granuleId,
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

  const collectionPgModel = new CollectionPgModel();
  [t.context.collectionCumulusId] = await collectionPgModel.create(
    t.context.knex,
    t.context.collection
  );

  const executionPgModel = new ExecutionPgModel();
  const execution = fakeExecutionRecordFactory({
    arn: t.context.executionArn,
  });
  [t.context.executionCumulusId] = await executionPgModel.create(
    t.context.knex,
    execution
  );

  const providerPgModel = new ProviderPgModel();
  [t.context.providerCumulusId] = await providerPgModel.create(
    t.context.knex,
    t.context.provider
  );
});

test.after.always(async (t) => {
  const {
    granuleModel,
  } = t.context;
  await granuleModel.deleteTable();
  await destroyLocalTestDb({
    ...t.context,
  });
});

test('generateGranuleRecord() generates the correct granule record', async (t) => {
  const {
    granuleId,
    granule,
    workflowStartTime,
  } = t.context;

  const timestamp = workflowStartTime + 5000;
  const updatedAt = Date.now();
  // Set granule files
  const files = [
    fakeFileFactory({
      size: 10,
    }),
  ];
  granule.sync_granule_duration = 3000;
  granule.post_to_cmr_duration = 7810;
  const queryFields = { foo: 'bar' };

  t.like(
    await generateGranuleRecord({
      granule,
      files,
      workflowStartTime,
      workflowStatus: 'running',
      collectionCumulusId: 1,
      providerCumulusId: 2,
      pdrCumulusId: 4,
      timestamp,
      updatedAt,
      queryFields,
    }),
    {
      granule_id: granuleId,
      status: 'running',
      cmr_link: granule.cmrLink,
      published: granule.published,
      created_at: new Date(workflowStartTime),
      timestamp: new Date(timestamp),
      updated_at: new Date(updatedAt),
      product_volume: 10,
      duration: 5,
      time_to_process: 3,
      time_to_archive: 7.81,
      collection_cumulus_id: 1,
      provider_cumulus_id: 2,
      pdr_cumulus_id: 4,
      query_fields: queryFields,
    }
  );
});

test('generateGranuleRecord() includes processing time info, if provided', async (t) => {
  const {
    cumulusMessage,
    granule,
  } = t.context;

  const processingTimeInfo = {
    processingStartDateTime: new Date().toISOString(),
    processingEndDateTime: new Date().toISOString(),
  };

  const record = await generateGranuleRecord({
    cumulusMessage,
    granule,
    processingTimeInfo,
  });
  t.is(record.processing_start_date_time, processingTimeInfo.processingStartDateTime);
  t.is(record.processing_end_date_time, processingTimeInfo.processingEndDateTime);
});

test('generateGranuleRecord() includes temporal info, if any is returned', async (t) => {
  const {
    cumulusMessage,
    granule,
  } = t.context;

  const temporalInfo = {
    beginningDateTime: new Date().toISOString(),
  };

  const fakeCmrUtils = {
    getGranuleTemporalInfo: async () => temporalInfo,
  };

  const record = await generateGranuleRecord({
    cumulusMessage,
    granule,
    cmrUtils: fakeCmrUtils,
  });
  t.is(record.beginning_date_time, temporalInfo.beginningDateTime);
});

test('generateGranuleRecord() includes correct error if cumulus message has an exception', async (t) => {
  const {
    granule,
  } = t.context;

  const exception = {
    Error: new Error('error'),
    Cause: 'an error occurred',
  };

  const record = await generateGranuleRecord({
    granule,
    error: exception,
  });
  t.deepEqual(record.error, exception);
});

test('generateFileRecord() adds granule cumulus ID', (t) => {
  const file = {
    bucket: cryptoRandomString({ length: 3 }),
    key: cryptoRandomString({ length: 3 }),
  };
  const record = generateFileRecord({ file, granuleCumulusId: 1 });
  t.is(record.granule_cumulus_id, 1);
});

test('getGranuleCumulusIdFromQueryResultOrLookup() returns cumulus ID from database if query result is empty', async (t) => {
  const granuleRecord = fakeGranuleRecordFactory();
  const fakeGranuleCumulusId = Math.floor(Math.random() * 1000);
  const fakeGranulePgModel = {
    getRecordCumulusId: async (_, record) => {
      if (record.granule_id === granuleRecord.granule_id) {
        return fakeGranuleCumulusId;
      }
      return undefined;
    },
  };

  t.is(
    await getGranuleCumulusIdFromQueryResultOrLookup({
      trx: {},
      queryResult: [],
      granuleRecord,
      granulePgModel: fakeGranulePgModel,
    }),
    fakeGranuleCumulusId
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
    knex.transaction(
      (trx) =>
        writeFilesViaTransaction({
          fileRecords,
          trx,
          filePgModel: fakeFilePgModel,
        })
    )
  );
});

test('writeGranules() throws an error if collection is not provided', async (t) => {
  const {
    cumulusMessage,
    knex,
    executionCumulusId,
    providerCumulusId,
    granuleModel,
  } = t.context;
  await t.throwsAsync(
    writeGranules({
      cumulusMessage,
      collectionCumulusId: undefined,
      executionCumulusId,
      providerCumulusId,
      knex,
      granuleModel,
    })
  );
});

test('writeGranules() saves granule records to Dynamo and RDS if RDS write is enabled', async (t) => {
  const {
    cumulusMessage,
    granuleModel,
    knex,
    collectionCumulusId,
    executionCumulusId,
    providerCumulusId,
    granuleId,
  } = t.context;

  await writeGranules({
    cumulusMessage,
    collectionCumulusId,
    executionCumulusId,
    providerCumulusId,
    knex,
    granuleModel,
  });

  t.true(await granuleModel.exists({ granuleId }));
  t.true(
    await doesRecordExist({ granule_id: granuleId }, knex, tableNames.granules)
  );
});

test('writeGranules() handles successful and failing writes independently', async (t) => {
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

  await t.throwsAsync(writeGranules({
    cumulusMessage,
    collectionCumulusId,
    executionCumulusId,
    providerCumulusId,
    knex,
    granuleModel,
  }));

  t.true(await granuleModel.exists({ granuleId }));
  t.true(
    await doesRecordExist({ granule_id: granuleId }, knex, tableNames.granules)
  );
});

test('writeGranules() throws error if any granule writes fail', async (t) => {
  const {
    cumulusMessage,
    knex,
    collectionCumulusId,
    executionCumulusId,
    providerCumulusId,
    granuleModel,
  } = t.context;

  cumulusMessage.payload.granules = [
    ...cumulusMessage.payload.granules,
    // this object is not a valid granule, so its write should fail
    {},
  ];

  await t.throwsAsync(writeGranules({
    cumulusMessage,
    collectionCumulusId,
    executionCumulusId,
    providerCumulusId,
    knex,
    granuleModel,
  }));
});

test('writeGranules() throws error if any file records are invalid', async (t) => {
  const {
    cumulusMessage,
    knex,
    collectionCumulusId,
    executionCumulusId,
    providerCumulusId,
    granuleModel,
  } = t.context;

  cumulusMessage.payload.granules[0].files[0].bucket = undefined;
  cumulusMessage.payload.granules[0].files[0].key = undefined;

  await t.throwsAsync(writeGranules({
    cumulusMessage,
    collectionCumulusId,
    executionCumulusId,
    providerCumulusId,
    knex,
    granuleModel,
  }));
});

test('writeGranules() does not persist granule or files if any file is invalid', async (t) => {
  const {
    cumulusMessage,
    knex,
    collectionCumulusId,
    executionCumulusId,
    providerCumulusId,
    granuleModel,
    granuleId,
  } = t.context;

  cumulusMessage.payload.granules[0].files[0].bucket = undefined;
  cumulusMessage.payload.granules[0].files[0].key = undefined;

  await t.throwsAsync(writeGranules({
    cumulusMessage,
    collectionCumulusId,
    executionCumulusId,
    providerCumulusId,
    knex,
    granuleModel,
  }));

  // If no granule was persisted, files could not have been created
  t.false(await granuleModel.exists({ granuleId }));
  t.false(
    await doesRecordExist({ granule_id: granuleId }, knex, tableNames.granules)
  );
});

test.serial('writeGranules() does not persist records to Dynamo or RDS if Dynamo write fails', async (t) => {
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
    storeGranuleFromCumulusMessage: () => {
      throw new Error('Granules dynamo error');
    },
    describeGranuleExecution: async () => ({}),
  };

  const [error] = await t.throwsAsync(
    writeGranules({
      cumulusMessage,
      collectionCumulusId,
      executionCumulusId,
      providerCumulusId,
      knex,
      granuleModel: fakeGranuleModel,
    })
  );

  t.true(error.message.includes('Granules dynamo error'));
  t.false(await granuleModel.exists({ granuleId }));
  t.false(
    await doesRecordExist({ granule_id: granuleId }, knex, tableNames.granules)
  );
});

test.serial('writeGranules() does not persist records to Dynamo or RDS if RDS write fails', async (t) => {
  const {
    cumulusMessage,
    granuleModel,
    knex,
    collectionCumulusId,
    executionCumulusId,
    providerCumulusId,
    granuleId,
  } = t.context;

  const fakeTrxCallback = (cb) => {
    const fakeTrx = sinon.stub().returns({
      insert: () => {
        throw new Error('Granules RDS error');
      },
    });
    return cb(fakeTrx);
  };
  const trxStub = sinon.stub(knex, 'transaction').callsFake(fakeTrxCallback);
  t.teardown(() => trxStub.restore());

  const [error] = await t.throwsAsync(writeGranules({
    cumulusMessage,
    collectionCumulusId,
    executionCumulusId,
    providerCumulusId,
    knex,
    granuleModel,
  }));

  t.true(error.message.includes('Granules RDS error'));
  t.false(await granuleModel.exists({ granuleId }));
  t.false(
    await doesRecordExist({ granule_id: granuleId }, knex, tableNames.granules)
  );
});
