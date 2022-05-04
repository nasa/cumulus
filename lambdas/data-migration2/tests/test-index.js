const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const Collection = require('@cumulus/api/models/collections');
const Execution = require('@cumulus/api/models/executions');
const Granule = require('@cumulus/api/models/granules');
const Pdr = require('@cumulus/api/models/pdrs');
const Provider = require('@cumulus/api/models/providers');

const {
  fakeGranuleFactoryV2,
  fakeExecutionFactoryV2,
  fakePdrFactoryV2,
} = require('@cumulus/api/lib/testUtils');

const {
  createBucket,
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');

const {
  CollectionPgModel,
  destroyLocalTestDb,
  ExecutionPgModel,
  fakeCollectionRecordFactory,
  fakeProviderRecordFactory,
  generateLocalTestDb,
  GranulePgModel,
  GranulesExecutionsPgModel,
  localStackConnectionEnv,
  PdrPgModel,
  ProviderPgModel,
  migrationDir,
} = require('@cumulus/db');

const { constructCollectionId } = require('@cumulus/message/Collections');

const { handler } = require('../dist/lambda');

const testDbName = `data_migration_2_${cryptoRandomString({ length: 10 })}`;

test.before(async (t) => {
  process.env = {
    ...process.env,
    ...localStackConnectionEnv,
    PG_DATABASE: testDbName,
    stackName: cryptoRandomString({ length: 10 }),
    system_bucket: cryptoRandomString({ length: 10 }),
    CollectionsTable: cryptoRandomString({ length: 10 }),
    ExecutionsTable: cryptoRandomString({ length: 10 }),
    GranulesTable: cryptoRandomString({ length: 10 }),
    PdrsTable: cryptoRandomString({ length: 10 }),
    ProvidersTable: cryptoRandomString({ length: 10 }),
  };

  await createBucket(process.env.system_bucket);

  t.context.collectionsModel = new Collection();
  t.context.executionsModel = new Execution();
  t.context.granulesModel = new Granule();
  t.context.pdrsModel = new Pdr();
  t.context.providersModel = new Provider();

  await Promise.all([
    t.context.collectionsModel.createTable(),
    t.context.executionsModel.createTable(),
    t.context.granulesModel.createTable(),
    t.context.pdrsModel.createTable(),
    t.context.providersModel.createTable(),
  ]);

  const { knex, knexAdmin } = await generateLocalTestDb(testDbName, migrationDir);
  t.context.knex = knex;
  t.context.knexAdmin = knexAdmin;

  t.context.pdrPgModel = new PdrPgModel();
  t.context.collectionPgModel = new CollectionPgModel();
  t.context.providerPgModel = new ProviderPgModel();
  t.context.executionPgModel = new ExecutionPgModel();
  t.context.granulePgModel = new GranulePgModel();
  t.context.granulesExecutionsPgModel = new GranulesExecutionsPgModel();
});

test.beforeEach(async (t) => {
  const testCollection = fakeCollectionRecordFactory();
  const [pgCollection] = await t.context.collectionPgModel.create(
    t.context.knex,
    testCollection
  );
  t.context.collectionCumulusId = pgCollection.cumulus_id;
  t.context.testCollection = testCollection;

  const testProvider = fakeProviderRecordFactory();
  await t.context.providerPgModel.create(
    t.context.knex,
    testProvider
  );
  t.context.testProvider = testProvider;

  const executionUrl = cryptoRandomString({ length: 5 });
  t.context.executionUrl = executionUrl;
});

test.after.always(async (t) => {
  await t.context.granulesModel.deleteTable();
  await t.context.pdrsModel.deleteTable();
  await t.context.providersModel.deleteTable();
  await t.context.collectionsModel.deleteTable();
  await t.context.executionsModel.deleteTable();

  await recursivelyDeleteS3Bucket(process.env.system_bucket);

  await destroyLocalTestDb({
    knex: t.context.knex,
    knexAdmin: t.context.knexAdmin,
    testDbName,
  });
});

async function cleanupRecords({
  executionsModel,
  granulesModel,
  pdrsModel,
  knex,
  granulePgModel,
  pdrPgModel,
  executionPgModel,
  granuleRecords,
  pdrRecords,
  executionRecords,
  testPdr,
  fakeGranule,
  fakeExecution,
}) {
  if (granuleRecords) {
    await Promise.all(granuleRecords.map(
      async ({ cumulus_id: cumulusId }) => {
        await granulePgModel.delete(knex, { cumulus_id: cumulusId });
      }
    ));
  }
  if (pdrRecords) {
    await Promise.all(pdrRecords.map(
      async ({ cumulus_id: cumulusId }) => {
        await pdrPgModel.delete(knex, { cumulus_id: cumulusId });
      }
    ));
  }
  if (executionRecords) {
    await Promise.all(executionRecords.map(
      async ({ cumulus_id: cumulusId }) => {
        await executionPgModel.delete(knex, { cumulus_id: cumulusId });
      }
    ));
  }

  await Promise.all([
    pdrsModel.delete({ pdrName: testPdr.pdrName }),
    granulesModel.delete({ granuleId: fakeGranule.granuleId }),
    executionsModel.delete({ arn: fakeExecution.arn }),
  ]);
}

test.serial('handler migrates executions, granules, files, and PDRs by default', async (t) => {
  const {
    executionsModel,
    granulesModel,
    pdrsModel,
    testCollection,
    testProvider,
  } = t.context;

  const collectionId = constructCollectionId(testCollection.name, testCollection.version);
  const fakeExecution = fakeExecutionFactoryV2({
    parentArn: undefined,
  });

  const testPdr = fakePdrFactoryV2({
    collectionId,
    provider: testProvider.name,
  });

  const fakeGranule = fakeGranuleFactoryV2({
    collectionId,
    execution: fakeExecution.execution,
    pdrName: testPdr.pdrName,
  });

  await Promise.all([
    executionsModel.create(fakeExecution),
    granulesModel.create(fakeGranule),
    pdrsModel.create(testPdr),
  ]);

  await handler({ env: process.env });

  const executionRecords = await t.context.executionPgModel.search(
    t.context.knex,
    { arn: fakeExecution.arn }
  );
  t.is(
    executionRecords.length,
    1
  );

  const pdrRecords = await t.context.pdrPgModel.search(
    t.context.knex,
    { name: testPdr.pdrName }
  );
  t.is(
    pdrRecords.length,
    1
  );

  const granuleRecords = await t.context.granulePgModel.search(
    t.context.knex,
    { granule_id: fakeGranule.granuleId }
  );
  t.is(
    granuleRecords.length,
    1
  );
  t.is(
    granuleRecords[0].pdr_cumulus_id,
    pdrRecords[0].cumulus_id
  );

  const granulesExecutionRecords = await t.context.granulesExecutionsPgModel.search(
    t.context.knex,
    {
      execution_cumulus_id: executionRecords[0].cumulus_id,
      granule_cumulus_id: granuleRecords[0].cumulus_id,
    }
  );
  t.is(
    granulesExecutionRecords.length,
    1
  );

  t.teardown(() => cleanupRecords({
    ...t.context,
    testPdr,
    fakeGranule,
    fakeExecution,
    executionRecords,
    granuleRecords,
    pdrRecords,
  }));
});

test.serial('handler migrates only executions if configured', async (t) => {
  const {
    executionsModel,
    granulesModel,
    pdrsModel,
    testCollection,
    testProvider,
  } = t.context;

  const collectionId = constructCollectionId(testCollection.name, testCollection.version);
  const fakeExecution = fakeExecutionFactoryV2({
    parentArn: undefined,
  });

  const testPdr = fakePdrFactoryV2({
    collectionId,
    provider: testProvider.name,
  });

  const fakeGranule = fakeGranuleFactoryV2({
    collectionId,
    execution: fakeExecution.execution,
    pdrName: testPdr.pdrName,
  });

  await Promise.all([
    executionsModel.create(fakeExecution),
    granulesModel.create(fakeGranule),
    pdrsModel.create(testPdr),
  ]);

  await handler({
    env: process.env,
    migrationsList: ['executions'],
  });

  const executionRecords = await t.context.executionPgModel.search(
    t.context.knex,
    { arn: fakeExecution.arn }
  );
  t.is(
    executionRecords.length,
    1
  );

  const granuleRecords = await t.context.granulePgModel.search(
    t.context.knex,
    { granule_id: fakeGranule.granuleId }
  );
  t.is(
    granuleRecords.length,
    0
  );

  const pdrRecords = await t.context.pdrPgModel.search(
    t.context.knex,
    { name: testPdr.pdrName }
  );
  t.is(
    pdrRecords.length,
    0
  );

  t.teardown(() => cleanupRecords({
    ...t.context,
    testPdr,
    fakeGranule,
    fakeExecution,
    executionRecords,
    granuleRecords,
    pdrRecords,
  }));
});

test.serial('handler migrates only granules if configured', async (t) => {
  const {
    executionsModel,
    granulesModel,
    pdrsModel,
    testCollection,
    testProvider,
  } = t.context;

  const collectionId = constructCollectionId(testCollection.name, testCollection.version);
  const fakeExecution = fakeExecutionFactoryV2({
    parentArn: undefined,
  });

  const executionUrl = cryptoRandomString({ length: 10 });
  const fakeGranule = fakeGranuleFactoryV2({
    collectionId,
    execution: executionUrl,
  });
  const testPdr = fakePdrFactoryV2({
    collectionId,
    provider: testProvider.name,
  });

  await Promise.all([
    executionsModel.create(fakeExecution),
    granulesModel.create(fakeGranule),
    pdrsModel.create(testPdr),
  ]);

  await handler({
    env: process.env,
    migrationsList: ['granules'],
  });

  const executionRecords = await t.context.executionPgModel.search(
    t.context.knex,
    { arn: fakeExecution.arn }
  );
  t.is(
    executionRecords.length,
    0
  );

  const granuleRecords = await t.context.granulePgModel.search(
    t.context.knex,
    { granule_id: fakeGranule.granuleId }
  );
  t.is(
    granuleRecords.length,
    1
  );

  const pdrRecords = await t.context.pdrPgModel.search(
    t.context.knex,
    { name: testPdr.pdrName }
  );
  t.is(
    pdrRecords.length,
    0
  );

  t.teardown(() => cleanupRecords({
    ...t.context,
    testPdr,
    fakeGranule,
    fakeExecution,
    executionRecords,
    granuleRecords,
    pdrRecords,
  }));
});

test.serial('handler migrates only PDRs if configured', async (t) => {
  const {
    executionsModel,
    granulesModel,
    pdrsModel,
    testCollection,
    testProvider,
  } = t.context;

  const collectionId = constructCollectionId(testCollection.name, testCollection.version);
  const fakeExecution = fakeExecutionFactoryV2({
    parentArn: undefined,
  });

  const fakeGranule = fakeGranuleFactoryV2({
    collectionId,
    execution: fakeExecution.execution,
  });
  const testPdr = fakePdrFactoryV2({
    collectionId,
    provider: testProvider.name,
  });

  await Promise.all([
    executionsModel.create(fakeExecution),
    granulesModel.create(fakeGranule),
    pdrsModel.create(testPdr),
  ]);

  await handler({
    env: process.env,
    migrationsList: ['pdrs'],
  });

  const executionRecords = await t.context.executionPgModel.search(
    t.context.knex,
    { arn: fakeExecution.arn }
  );
  t.is(
    executionRecords.length,
    0
  );

  const granuleRecords = await t.context.granulePgModel.search(
    t.context.knex,
    { granule_id: fakeGranule.granuleId }
  );
  t.is(
    granuleRecords.length,
    0
  );

  const pdrRecords = await t.context.pdrPgModel.search(
    t.context.knex,
    { name: testPdr.pdrName }
  );
  t.is(
    pdrRecords.length,
    1
  );

  t.teardown(() => cleanupRecords({
    ...t.context,
    testPdr,
    fakeGranule,
    fakeExecution,
    executionRecords,
    granuleRecords,
    pdrRecords,
  }));
});
