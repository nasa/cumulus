'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const sinon = require('sinon');

const {
  localStackConnectionEnv,
  getKnexClient,
  tableNames,
  doesRecordExist,
} = require('@cumulus/db');

const {
  generateGranuleRecord,
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

  t.context.knexAdmin = await getKnexClient({ env: localStackConnectionEnv });
  await t.context.knexAdmin.raw(`create database "${t.context.testDbName}";`);
  await t.context.knexAdmin.raw(`grant all privileges on database "${t.context.testDbName}" to "${localStackConnectionEnv.PG_USER}"`);

  t.context.knex = await getKnexClient({
    env: {
      ...localStackConnectionEnv,
      PG_DATABASE: t.context.testDbName,
      migrationDir,
    },
  });
  await t.context.knex.migrate.latest();
});

test.beforeEach(async (t) => {
  const stateMachineName = cryptoRandomString({ length: 5 });
  t.context.stateMachineArn = `arn:aws:states:us-east-1:12345:stateMachine:${stateMachineName}`;

  t.context.executionName = cryptoRandomString({ length: 5 });
  t.context.executionArn = `arn:aws:states:us-east-1:12345:execution:${stateMachineName}:${t.context.executionName}`;

  t.context.collection = {
    name: cryptoRandomString({ length: 5 }),
    version: '0.0.0',
    sample_file_name: 'file.txt',
    granule_id_extraction_regex: 'fake-regex',
    granule_id_validation_regex: 'fake-regex',
    files: JSON.stringify([{
      regex: 'fake-regex',
      sampleFileName: 'file.txt',
    }]),
  };

  t.context.provider = {
    id: `provider${cryptoRandomString({ length: 5 })}`,
    host: 'test-bucket',
    protocol: 's3',
  };

  t.context.granuleId = cryptoRandomString({ length: 10 });
  t.context.files = [fakeFileFactory()];
  t.context.granule = fakeGranuleFactoryV2({
    files: t.context.files,
    granuleId: t.context.granuleId,
  });

  t.context.worklowStartTime = Date.now();
  t.context.cumulusMessage = {
    cumulus_meta: {
      workflow_start_time: t.context.worklowStartTime,
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

  const collectionResponse = await t.context.knex(tableNames.collections)
    .insert(t.context.collection)
    .returning('cumulus_id');
  t.context.collectionCumulusId = collectionResponse[0];

  const providerResponse = await t.context.knex(tableNames.providers)
    .insert({
      name: t.context.provider.id,
      host: t.context.provider.host,
      protocol: t.context.provider.protocol,
    })
    .returning('cumulus_id');
  t.context.providerCumulusId = providerResponse[0];
});

test.after.always(async (t) => {
  const {
    granuleModel,
  } = t.context;
  await granuleModel.deleteTable();
  await t.context.knex.destroy();
  await t.context.knexAdmin.raw(`drop database if exists "${t.context.testDbName}"`);
  await t.context.knexAdmin.destroy();
});

test('generateGranuleRecord() generates the correct granule record', async (t) => {
  const {
    cumulusMessage,
    granuleId,
    granule,
    worklowStartTime,
  } = t.context;

  const timestamp = worklowStartTime + 5000;
  const updatedAt = Date.now();
  // Set granule files
  const files = [
    fakeFileFactory({
      size: 10,
    }),
  ];
  granule.files = files;
  granule.sync_granule_duration = 3000;
  granule.post_to_cmr_duration = 7810;

  t.deepEqual(
    await generateGranuleRecord({
      cumulusMessage,
      granule,
      collectionCumulusId: 1,
      providerCumulusId: 2,
      executionCumulusId: 3,
      pdrCumulusId: 4,
      timestamp,
      updatedAt,
    }),
    {
      granuleId,
      status: 'running',
      cmrLink: granule.cmrLink,
      published: granule.published,
      error: {},
      files,
      createdAt: new Date(worklowStartTime),
      timestamp: new Date(timestamp),
      updatedAt: new Date(updatedAt),
      productVolume: 10,
      duration: 5,
      timeToPreprocess: 3,
      timeToArchive: 7.81,
      collection_cumulus_id: 1,
      provider_cumulus_id: 2,
      execution_cumulus_id: 3,
      pdr_cumulus_id: 4,
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

  const fakeFileUtils = {
    buildDatabaseFiles: async () => granule.files,
  };

  const record = await generateGranuleRecord({
    cumulusMessage,
    granule,
    processingTimeInfo,
    fileUtils: fakeFileUtils,
  });
  t.is(record.processingStartDateTime, processingTimeInfo.processingStartDateTime);
  t.is(record.processingEndDateTime, processingTimeInfo.processingEndDateTime);
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
  const fakeFileUtils = {
    buildDatabaseFiles: async () => granule.files,
  };

  const record = await generateGranuleRecord({
    cumulusMessage,
    granule,
    cmrUtils: fakeCmrUtils,
    fileUtils: fakeFileUtils,
  });
  t.is(record.beginningDateTime, temporalInfo.beginningDateTime);
});

test('generateGranuleRecord() includes correct error if cumulus message has an exception', async (t) => {
  const {
    cumulusMessage,
    granule,
  } = t.context;

  const exception = {
    Error: new Error('error'),
    Cause: 'an error occurred',
  };
  cumulusMessage.exception = exception;

  const fakeFileUtils = {
    buildDatabaseFiles: async () => granule.files,
  };

  const record = await generateGranuleRecord({
    cumulusMessage,
    granule,
    fileUtils: fakeFileUtils,
  });
  t.deepEqual(record.error, exception);
});

test('writeGranules() throws an error if collection is not provided', async (t) => {
  const { cumulusMessage, knex, providerCumulusId, granuleModel } = t.context;
  await t.throwsAsync(
    writeGranules({
      cumulusMessage,
      collectionCumulusId: undefined,
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
    providerCumulusId,
    granuleId,
  } = t.context;

  await writeGranules({
    cumulusMessage,
    collectionCumulusId,
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
    providerCumulusId,
    knex,
    granuleModel,
  }));
});

test.serial('writeGranules() does not persist records to Dynamo or RDS if Dynamo write fails', async (t) => {
  const {
    cumulusMessage,
    granuleModel,
    knex,
    collectionCumulusId,
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
