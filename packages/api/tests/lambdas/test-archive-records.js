'use strict';

const moment = require('moment');
const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
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

const { handler, getParsedConfigValues } = require('../../ts-lambdas/archive-records');

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
  let pgGranules = [];
  if (granules.length > 0) {
    pgGranules = await granuleModel.create(
      knex,
      granules.map((granule) => ({
        ...granule,
        collection_cumulus_id: collectionInserted[0].cumulus_id,
      })),
      ['cumulus_id']
    );
  }
  let pgExecutions = [];
  if (executions.length > 0) {
    pgExecutions = await executionModel.create(
      knex,
      executions,
      ['cumulus_id']
    );
  }
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

test.serial('ArchiveRecords sets old records to "archived=true"', async (t) => {
  const config = {
    expirationDays: 1,
    recordType: 'granule',
  };
  const { pgGranules } = await setupDataStoreData(
    [fakeGranuleRecordFactory({
      granule_id: cryptoRandomString({ length: 5 }),
      updated_at: new Date(moment.now() - 3 * epochDay),
    })],
    [],
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
});

test.serial('ArchiveRecords sets old records to "archived=true" and not newer records', async (t) => {
  const config = {
    expirationDays: 5,
  };
  const { pgGranules } = await setupDataStoreData(
    range(100).map((i) => fakeGranuleRecordFactory({
      granule_id: `${i}`,
      updated_at: new Date(moment.now() - i * epochDay),
    })),
    [],
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
});

test.serial('ArchiveRecords archives only executions if recordType=executions', async (t) => {
  const config = {
    expirationDays: 1,
    recordType: 'execution',
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
    recordType: 'granule',
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
  const { pgGranules } = await setupDataStoreData(
    range(20).map((i) => fakeGranuleRecordFactory({
      granule_id: `${i}`,
      updated_at: new Date(moment.now() - i * epochDay),
    })),
    [],
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
});

test.serial('ArchiveRecords archives "updateLimit" with larger batchSize', async (t) => {
  const config = {
    expirationDays: 5,
    updateLimit: 50,
    batchSize: 60,
    recordType: 'execution',
  };
  const { pgExecutions } = await setupDataStoreData(
    [],
    range(100).map((i) => fakeExecutionRecordFactory({
      arn: `${i}`,
      updated_at: new Date(moment.now() - i * epochDay),
    })),
    t
  );
  await handler({ config });
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

test('getParsedConfigValues handles empty config with defaults', (t) => {
  t.deepEqual(getParsedConfigValues(), {
    batchSize: 1000,
    updateLimit: 10000,
    expirationDays: 365,
    recordType: 'granule',
  });
});

test('getParsedConfigValues prefers explicit config values', (t) => {
  t.deepEqual(getParsedConfigValues({
    batchSize: 15,
    expirationDays: 2,
    updateLimit: 45,
    recordType: 'execution',
  }), {
    batchSize: 15,
    expirationDays: 2,
    updateLimit: 45,
    recordType: 'execution',
  });
});

test('getParsedConfigValues defaults mangled recordType to "granule"', (t) => {
  t.deepEqual(
    getParsedConfigValues({ recordType: 'abcd' }).recordType,
    'granule'
  );
});
