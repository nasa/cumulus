const test = require('ava');
const clone = require('lodash/clone');
const pMap = require('p-map');
const {
  CollectionPgModel,
  ProviderPgModel,
  fakeCollectionRecordFactory,
  fakeProviderRecordFactory,
  migrationDir,
  generateLocalTestDb,
  destroyLocalTestDb,
  GranulePgModel,
  ExecutionPgModel,
  GranulesExecutionsPgModel,
  FilePgModel,
} = require('@cumulus/db');
const { randomId } = require('@cumulus/common/test-utils');
const {
  getBatchParamGenerator,
  parseArgs,
  uploadDBGranules,
  uploadDataBatch,
} = require('../generate_db_records');

test.before(async (t) => {
  t.context.testDbName = randomId('generate_records');
  const { knex, knexAdmin } = await generateLocalTestDb(t.context.testDbName, migrationDir);

  t.context.knex = knex;
  t.context.knexAdmin = knexAdmin;
  const collectionModel = new CollectionPgModel();
  await collectionModel.create(
    t.context.knex,
    fakeCollectionRecordFactory({
      name: 'MOD09GQ_abc',
      version: '006',
    })
  );
  const providerPgModel = new ProviderPgModel();
  providerPgModel.create(
    t.context.knex,
    fakeProviderRecordFactory({ name: 'provider_test' })
  );
});
test.after.always(async (t) => {
  await destroyLocalTestDb({
    knex: t.context.knex,
    knexAdmin: t.context.knexAdmin,
    tesetDbName: t.context.testDbName,
  });
});

test('getBatchParamGenerator() yields a generator that plays well with pMap', async (t) => {
  t.throws(
    () => getBatchParamGenerator({
      knex: t.context.knex,
      granules: 0,
      collectionCumulusId: 0,
      providerCumulusId: 0,
      filesPerGranule: 0,
      granulesPerBatch: 0,
      models: {},
      variance: false,
    }),
    { message: 'granulesPerBatch must be set to >=1' }
  );

  let iterated = 0;
  const iterableGenerator = getBatchParamGenerator({
    knex: {},
    numberOfGranules: 5,
    collectionCumulusId: 0,
    providerCumulusId: 0,
    filesPerGranule: 0,
    granulesPerBatch: 1,
    executionsPerBatch: 0,
    models: {},
    variance: false,
  });
  await pMap(
    iterableGenerator,
    (params) => {
      t.deepEqual(
        params,
        {
          knex: {},
          collectionCumulusId: 0,
          providerCumulusId: 0,
          filesPerGranule: 0,
          granulesPerBatch: 1,
          executionsPerBatch: 0,
          models: {},
        }
      );
      iterated += 1;
    },
    { concurrency: 1 }
  );
  t.is(iterated, 5);
});
const setArgs = (args) => {
  process.argv = process.argv.slice(0, 2).concat(args);
};
test.serial('parseArgs() parses out arguments when given reasonable args', (t) => {
  const argv = clone(process.argv);
  setArgs([]);
  let args = parseArgs();
  const defaultArgs = {
    granules: 10000,
    files: 1,
    collections: 1,
    executionsPerBatch: 2,
    granulesPerBatch: 2,
    variance: false,
    concurrency: 1,
    swallowErrors: true,
  };
  t.deepEqual(args, defaultArgs);

  setArgs([
    '--collections=3',
    '--files=4',
    '--concurrency', '5',
    '--executionsPerGranule=3:5',
    '--variance=true',
    '--granulesK=112',
    '--swallowErrors', 'false',
  ]);
  args = parseArgs();
  t.deepEqual(args, {
    granules: 112000,
    files: 4,
    concurrency: 5,
    executionsPerBatch: 3,
    granulesPerBatch: 5,
    variance: true,
    collections: 3,
    swallowErrors: false,
  });

  setArgs([
    '--concurrency=12',
  ]);
  args = parseArgs();
  t.deepEqual(args, {
    ...defaultArgs,
    concurrency: 12,
  });

  setArgs([
    '-C=12',
  ]);
  args = parseArgs();
  t.deepEqual(args, {
    ...defaultArgs,
    concurrency: 12,
  });

  setArgs([
    '-c=3',
  ]);
  args = parseArgs();
  t.deepEqual(args, {
    ...defaultArgs,
    collections: 3,
  });

  setArgs([
    '-g=15',
  ]);
  args = parseArgs();
  t.deepEqual(args, {
    ...defaultArgs,
    granules: 15000,
  });

  setArgs([
    '-e=6:5',
  ]);
  args = parseArgs();
  t.deepEqual(args, {
    ...defaultArgs,
    executionsPerBatch: 6,
    granulesPerBatch: 5,
  });
  process.argv = argv;
});
test.serial("parseArgs() fails when executionsPerGranule doesn't follow a:b format", (t) => {
  const argv = clone(process.argv);
  setArgs([
    '--executionsPerGranule=35',
  ]);
  t.throws(
    parseArgs,
    { message: 'cannot parse 35, expected format <executions>:<granules> ratio \nError: only 1 value could be split from 35' }
  );
  process.argv = argv;
});

test('uploadDataBatch() uploads a batch of entries verified to be in the database', async (t) => {
  const providerPgModel = new ProviderPgModel();
  const collectionPgModel = new CollectionPgModel();

  const collectionRecord = fakeCollectionRecordFactory({
    name: 'MOD09GQ_abc',
    version: '007',
  });
  const providerRecord = fakeProviderRecordFactory();
  const [{ cumulus_id: providerCumulusId }] = await providerPgModel.upsert(
    t.context.knex,
    providerRecord
  );
  const [{ cumulus_id: collectionCumulusId }] = await collectionPgModel.upsert(
    t.context.knex,
    collectionRecord
  );
  const granuleModel = new GranulePgModel();
  const executionModel = new ExecutionPgModel();
  const geModel = new GranulesExecutionsPgModel();
  const fileModel = new FilePgModel();
  const cumulusIds = await uploadDataBatch({
    knex: t.context.knex,
    collectionCumulusId,
    providerCumulusId,
    granulesPerBatch: 12,
    executionsPerBatch: 3,
    filesPerGranule: 5,
    swallowErrors: false,
    models: {
      granuleModel,
      executionModel,
      geModel,
      fileModel,
    },
  });
  await Promise.all(cumulusIds.granuleCumulusIds.map(async (granule) => {
    t.true(await granuleModel.exists(t.context.knex, { cumulus_id: granule }));
  }));
  await Promise.all(cumulusIds.executionCumulusIds.map(async (execution) => {
    t.true(await executionModel.exists(t.context.knex, { cumulus_id: execution }));
  }));
  await Promise.all(cumulusIds.fileCumulusIds.map(async (file) => {
    t.true(await fileModel.exists(t.context.knex, { cumulus_id: file }));
  }));
  await Promise.all(cumulusIds.granuleCumulusIds.map(async (granule) => {
    await Promise.all(cumulusIds.executionCumulusIds.map(async (execution) => {
      t.true(await geModel.exists(
        t.context.knex,
        {
          granule_cumulus_id: granule,
          execution_cumulus_id: execution,
        }
      ));
    }));
  }));
});

test('uploadDBGranules() uploads a pile of entries', async (t) => {
  const providerPgModel = new ProviderPgModel();
  const collectionPgModel = new CollectionPgModel();

  const collectionRecord = fakeCollectionRecordFactory({
    name: 'MOD09GQ_abc',
    version: '007',
  });
  const providerRecord = fakeProviderRecordFactory();
  await providerPgModel.upsert(t.context.knex, providerRecord);
  await collectionPgModel.upsert(
    t.context.knex,
    collectionRecord
  );
  // this just asks if there's been an error. this relies on tests within test uploadDataBatch
  // because passing out batch returns to this level would be tantamount to a memory leak
  await uploadDBGranules(
    t.context.knex,
    providerRecord.name,
    collectionRecord,
    100,
    2,
    3,
    2,
    2,
    1
  );
  await uploadDBGranules(
    t.context.knex,
    providerRecord.name,
    collectionRecord,
    100,
    2,
    3,
    2,
    2,
    1,
    true
  );
  t.pass();
});
