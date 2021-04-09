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
  fakeExecutionRecordFactory,
  generateLocalTestDb,
  localStackConnectionEnv,
  PdrPgModel,
  ProviderPgModel,
  GranulePgModel,
} = require('@cumulus/db');

// eslint-disable-next-line node/no-unpublished-require
const { migrationDir } = require('../../db-migration');
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
});

test.beforeEach(async (t) => {
  const testCollection = fakeCollectionRecordFactory();
  [t.context.collectionCumulusId] = await t.context.collectionPgModel.create(
    t.context.knex,
    testCollection
  );
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
  await recursivelyDeleteS3Bucket(process.env.system_bucket);

  await destroyLocalTestDb({
    knex: t.context.knex,
    knexAdmin: t.context.knexAdmin,
    testDbName,
  });
});

test.serial('handler migrates executions, granules, files, and PDRs by default', async (t) => {
  const {
    executionsModel,
    granulesModel,
    pdrsModel,
    testCollection,
    testProvider,
  } = t.context;

  const collectionId = `${testCollection.name}___${testCollection.version}`;
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

  await handler({ env: process.env });

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

  t.teardown(() => Promise.all([
    pdrsModel.delete({ pdrName: testPdr.pdrName }),
    granulesModel.delete({ granuleId: fakeGranule.granuleId }),
    executionsModel.delete({ arn: fakeExecution.arn }),
    t.context.executionPgModel.delete(
      t.context.knex,
      { cumulus_id: executionRecords[0].cumulus_id }
    ),
    t.context.granulePgModel.delete(t.context.knex, { cumulus_id: granuleRecords[0].cumulus_id }),
    t.context.pdrPgModel.delete(t.context.knex, { cumulus_id: pdrRecords[0].cumulus_id }),
  ]));
});

test.serial('handler migrates only executions if configured', async (t) => {
  const {
    executionsModel,
    granulesModel,
    pdrsModel,
    testCollection,
    testProvider,
  } = t.context;

  const collectionId = `${testCollection.name}___${testCollection.version}`;
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

  t.teardown(() => Promise.all([
    pdrsModel.delete({ pdrName: testPdr.pdrName }),
    granulesModel.delete({ granuleId: fakeGranule.granuleId }),
    executionsModel.delete({ arn: fakeExecution.arn }),
    t.context.executionPgModel.delete(
      t.context.knex,
      { cumulus_id: executionRecords[0].cumulus_id }
    ),
  ]));
});

test.serial('handler migrates only granules if configured', async (t) => {
  const {
    executionsModel,
    granulesModel,
    pdrsModel,
    testCollection,
    testProvider,
  } = t.context;

  const collectionId = `${testCollection.name}___${testCollection.version}`;
  const fakeExecution = fakeExecutionFactoryV2({
    parentArn: undefined,
  });

  const executionUrl = cryptoRandomString({ length: 10 });
  const pgExecution = fakeExecutionRecordFactory({
    url: executionUrl,
  });
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

  const [executionCumulusId] = await t.context.executionPgModel.create(
    t.context.knex,
    pgExecution
  );

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

  t.teardown(() => Promise.all([
    pdrsModel.delete({ pdrName: testPdr.pdrName }),
    granulesModel.delete({ granuleId: fakeGranule.granuleId }),
    executionsModel.delete({ arn: fakeExecution.arn }),
    t.context.executionPgModel.delete(
      t.context.knex,
      { cumulus_id: executionCumulusId }
    ),
    t.context.granulePgModel.delete(
      t.context.knex,
      { cumulus_id: granuleRecords[0].cumulus_id }
    ),
  ]));
});

test.serial('handler migrates only PDRs if configured', async (t) => {
  const {
    executionsModel,
    granulesModel,
    pdrsModel,
    testCollection,
    testProvider,
  } = t.context;

  const collectionId = `${testCollection.name}___${testCollection.version}`;
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

  t.teardown(() => Promise.all([
    pdrsModel.delete({ pdrName: testPdr.pdrName }),
    granulesModel.delete({ granuleId: fakeGranule.granuleId }),
    executionsModel.delete({ arn: fakeExecution.arn }),
    t.context.pdrPgModel.delete(
      t.context.knex,
      { cumulus_id: pdrRecords[0].cumulus_id }
    ),
  ]));
});
