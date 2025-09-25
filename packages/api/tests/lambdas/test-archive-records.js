'use strict';

const moment = require('moment');
const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const clone = require('lodash/clone');
const range = require('lodash/range');
const { randomId } = require('@cumulus/common/test-utils');

const {
  generateLocalTestDb,
  destroyLocalTestDb,
  migrationDir,
  GranulePgModel,
  CollectionPgModel,
  fakeExecutionRecordFactory,
  ExecutionPgModel,
  localStackConnectionEnv,
  translateApiCollectionToPostgresCollection,
} = require('@cumulus/db');
const { fakeGranuleRecordFactory, fakeCollectionRecordFactory } = require('@cumulus/db/dist');

const { handler, getParsedConfigValues } = require('../../lambdas/archive-records');

const epochDay = 86400000;

async function setupDataStoreData(granules, executions, t) {
  const { knex } = t.context;
  const granuleModel = new GranulePgModel();
  const executionModel = new ExecutionPgModel();
  const collectionModel = new CollectionPgModel();

  const collection = fakeCollectionRecordFactory({
    name: 'MOD11A1',
    granuleIdExtraction: '(MOD11A1\\.(.*))\\.hdf',
    granuleId: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}$',
    dataType: 'MOD11A1',
    process: 'modis',
    version: '006',
    sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
    id: 'MOD11A1',
  });
  const collectionInserted = await collectionModel.create(
    knex,
    translateApiCollectionToPostgresCollection(collection)
  );
  const pgGranules = await granuleModel.create(
    knex,
    granules.map((granule) => ({
      ...granule,
      collection_cumulus_id: collectionInserted[0].cumulus_id,
    })),
    ['cumulus_id']
  );
  const pgExecutions = await executionModel.create(
    knex,
    executions,
    ['cumulus_id']
  );
  return {
    pgGranules,
    pgExecutions,
  };
}

test.beforeEach(async (t) => {
  const testDbName = `ArchiveRecords/${cryptoRandomString({ length: 10 })}`;
  const { knexAdmin, knex } = await generateLocalTestDb(
    testDbName,
    migrationDir
  );

  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;
  t.context.stackName = randomId('ArchiveRecords');

  process.env = {
    ...process.env,
    ...localStackConnectionEnv,
    PG_DATABASE: testDbName,
    stackName: t.context.stackName,
  };
});

test.afterEach.always(async (t) => {
  await destroyLocalTestDb({
    ...t.context,
  });
});

test.serial('ArchiveRecords sets old granules/executions to "archived=true"', async (t) => {
  const config = {
    expirationDays: 1,
  };
  const { pgGranules, pgExecutions } = await setupDataStoreData(
    [fakeGranuleRecordFactory({
      granule_id: cryptoRandomString({ length: 5 }),
      updated_at: new Date(moment.now() - 3 * epochDay),
    })],
    [fakeExecutionRecordFactory({
      updated_at: new Date(moment.now() - 3 * epochDay),
    })],
    t
  );
  await handler({ config });
  const granuleModel = new GranulePgModel();
  const granuleCumulusId = pgGranules[0].cumulus_id;
  const granule = await granuleModel.get(
    t.context.knex,
    {
      cumulus_id: granuleCumulusId,
    }
  );
  t.true(granule.archived);

  const executionModel = new ExecutionPgModel();
  const executionCumulusId = pgExecutions[0].cumulus_id;
  const execution = await executionModel.get(
    t.context.knex,
    {
      cumulus_id: executionCumulusId,
    }
  );
  t.true(execution.archived);
});

test.serial('ArchiveRecords sets old records to "archived=true" and not newer granules/executions', async (t) => {
  const config = {
    expirationDays: 5,
  };
  const { pgGranules, pgExecutions } = await setupDataStoreData(
    range(100).map((i) => fakeGranuleRecordFactory({
      granule_id: `${i}`,
      updated_at: new Date(moment.now() - i * epochDay),
    })),
    range(100).map((i) => fakeExecutionRecordFactory({
      arn: `${i}`,
      updated_at: new Date(moment.now() - i * epochDay),
    })),
    t
  );
  await handler({ config });
  const granuleModel = new GranulePgModel();
  const granules = await Promise.all(
    pgGranules.map(async (granule) => await granuleModel.get(
      t.context.knex,
      {
        cumulus_id: granule.cumulus_id,
      }
    ))
  );
  granules.forEach((granule) => {
    if (Number.parseInt(granule.granule_id, 10) < config.expirationDays) {
      t.false(granule.archived);
    } else {
      t.true(granule.archived);
    }
  });

  const executionModel = new ExecutionPgModel();
  const executions = await Promise.all(
    pgExecutions.map(async (execution) => await executionModel.get(
      t.context.knex,
      {
        cumulus_id: execution.cumulus_id,
      }
    ))
  );
  executions.forEach((execution) => {
    if (Number.parseInt(execution.arn, 10) < config.expirationDays) {
      t.false(execution.archived);
    } else {
      t.true(execution.archived);
    }
  });
});

test.serial('ArchiveRecords archives only executions if recordType=executions', async (t) => {
  const config = {
    expirationDays: 1,
    recordType: 'executions',
  };
  const { pgGranules, pgExecutions } = await setupDataStoreData(
    [fakeGranuleRecordFactory({
      granule_id: cryptoRandomString({ length: 5 }),
      updated_at: new Date(moment.now() - 3 * epochDay),
    })],
    [fakeExecutionRecordFactory({
      updated_at: new Date(moment.now() - 3 * epochDay),
    })],
    t
  );
  await handler({ config });
  const granuleModel = new GranulePgModel();
  const granuleCumulusId = pgGranules[0].cumulus_id;
  const granule = await granuleModel.get(
    t.context.knex,
    {
      cumulus_id: granuleCumulusId,
    }
  );
  t.false(granule.archived);

  const executionModel = new ExecutionPgModel();
  const executionCumulusId = pgExecutions[0].cumulus_id;
  const execution = await executionModel.get(
    t.context.knex,
    {
      cumulus_id: executionCumulusId,
    }
  );
  t.true(execution.archived);
});

test.serial('ArchiveRecords archives only granules if recordType=granules', async (t) => {
  const config = {
    expirationDays: 1,
    recordType: 'granules',
  };
  const { pgGranules, pgExecutions } = await setupDataStoreData(
    [fakeGranuleRecordFactory({
      granule_id: cryptoRandomString({ length: 5 }),
      updated_at: new Date(moment.now() - 3 * epochDay),
    })],
    [fakeExecutionRecordFactory({
      updated_at: new Date(moment.now() - 3 * epochDay),
    })],
    t
  );
  await handler({ config });
  const granuleModel = new GranulePgModel();
  const granuleCumulusId = pgGranules[0].cumulus_id;
  const granule = await granuleModel.get(
    t.context.knex,
    {
      cumulus_id: granuleCumulusId,
    }
  );
  t.true(granule.archived);

  const executionModel = new ExecutionPgModel();
  const executionCumulusId = pgExecutions[0].cumulus_id;
  const execution = await executionModel.get(
    t.context.knex,
    {
      cumulus_id: executionCumulusId,
    }
  );
  t.false(execution.archived);
});

test.serial('ArchiveRecords archives the entire "updateLimit" with odd batchSizes', async (t) => {
  const config = {
    expirationDays: 5,
    updateLimit: 10,
    batchSize: 6,
  };
  const { pgGranules, pgExecutions } = await setupDataStoreData(
    range(20).map((i) => fakeGranuleRecordFactory({
      granule_id: `${i}`,
      updated_at: new Date(moment.now() - i * epochDay),
    })),
    range(20).map((i) => fakeExecutionRecordFactory({
      arn: `${i}`,
      updated_at: new Date(moment.now() - i * epochDay),
    })),
    t
  );
  await handler({ config });
  const granuleModel = new GranulePgModel();
  const granules = await Promise.all(
    pgGranules.map(async (granule) => await granuleModel.get(
      t.context.knex,
      {
        cumulus_id: granule.cumulus_id,
      }
    ))
  );
  granules.forEach((granule) => {
    if (Number.parseInt(granule.granule_id, 10) < config.expirationDays) {
      t.false(granule.archived);
    }
  });
  t.is(granules.filter((granule) => granule.archived).length, 10);

  const executionModel = new ExecutionPgModel();
  const executions = await Promise.all(
    pgExecutions.map(async (execution) => await executionModel.get(
      t.context.knex,
      {
        cumulus_id: execution.cumulus_id,
      }
    ))
  );
  executions.forEach((execution) => {
    if (Number.parseInt(execution.arn, 10) < config.expirationDays) {
      t.false(execution.archived);
    }
  });

  t.is(executions.filter((execution) => execution.archived).length, 10);
});

test.serial('ArchiveRecords archives "updateLimit" with larger batchSize', async (t) => {
  const config = {
    expirationDays: 5,
    updateLimit: 50,
    batchSize: 60,
  };
  const { pgGranules, pgExecutions } = await setupDataStoreData(
    range(100).map((i) => fakeGranuleRecordFactory({
      granule_id: `${i}`,
      updated_at: new Date(moment.now() - i * epochDay),
    })),
    range(100).map((i) => fakeExecutionRecordFactory({
      arn: `${i}`,
      updated_at: new Date(moment.now() - i * epochDay),
    })),
    t
  );
  await handler({ config });
  const granuleModel = new GranulePgModel();
  const granules = await Promise.all(
    pgGranules.map(async (granule) => await granuleModel.get(
      t.context.knex,
      {
        cumulus_id: granule.cumulus_id,
      }
    ))
  );
  granules.forEach((granule) => {
    if (Number.parseInt(granule.granule_id, 10) < config.expirationDays) {
      t.false(granule.archived);
    }
  });
  t.is(granules.filter((granule) => granule.archived).length, 50);

  const executionModel = new ExecutionPgModel();
  const executions = await Promise.all(
    pgExecutions.map(async (execution) => await executionModel.get(
      t.context.knex,
      {
        cumulus_id: execution.cumulus_id,
      }
    ))
  );
  executions.forEach((execution) => {
    if (Number.parseInt(execution.arn, 10) < config.expirationDays) {
      t.false(execution.archived);
    }
  });

  t.is(executions.filter((execution) => execution.archived).length, 50);
});

test.serial('getParsedConfigValues handles empty config and no env with defaults', (t) => {
  const envStore = clone(process.env);
  delete process.env.UPDATE_LIMIT;
  delete process.env.BATCH_SIZE;
  delete process.env.EXPIRATION_DAYS;
  t.deepEqual(getParsedConfigValues(), {
    batchSize: 1000,
    updateLimit: 10000,
    expirationDays: 365,
    recordType: 'both',
  });
  process.env = envStore;
});

test.serial('getParsedConfigValues handles empty config and prefers env to defaults', (t) => {
  const envStore = clone(process.env);
  process.env.BATCH_SIZE = 23;
  process.env.UPDATE_LIMIT = 2005;
  process.env.EXPIRATION_DAYS = 2345;
  t.deepEqual(getParsedConfigValues(), {
    batchSize: 23,
    updateLimit: 2005,
    expirationDays: 2345,
    recordType: 'both',
  });
  process.env = envStore;
});

test.serial('getParsedConfigValues prefers explicit config values', (t) => {
  const envStore = clone(process.env);
  process.env.BATCH_SIZE = 23;
  process.env.EXPIRATION_DAYS = 2345;
  process.env.UPDATE_LIMIT = 56;
  t.deepEqual(getParsedConfigValues({
    batchSize: 15,
    expirationDays: 2,
    updateLimit: 45,
    recordType: 'granules',
  }), {
    batchSize: 15,
    expirationDays: 2,
    updateLimit: 45,
    recordType: 'granules',
  });
  process.env = envStore;
});
