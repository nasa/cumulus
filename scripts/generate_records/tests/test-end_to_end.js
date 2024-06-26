const test = require('ava');
const {
  generateLocalTestDb,
  destroyLocalTestDb,
  migrationDir,
  localStackConnectionEnv,
  CollectionPgModel,
  ExecutionPgModel,
  FilePgModel,
  GranulesExecutionsPgModel,
  GranulePgModel,
} = require('@cumulus/db');
const clone = require('lodash/clone');
const { randomId } = require('@cumulus/common/test-utils');
const generate_db_records = require('../generate_db_records');
const generate_db_executions = require('../generate_db_executions');
test.beforeEach(async (t) => {
  t.context.testDbName = randomId('generate_records');
  const { knex, knexAdmin } = await generateLocalTestDb(t.context.testDbName, migrationDir);
  t.context.knex = knex;
  t.context.knexAdmin = knexAdmin;
});

test.afterEach.always(async (t) => {
  await destroyLocalTestDb({
    knex: t.context.knex,
    knexAdmin: t.context.knexAdmin,
    tesetDbName: t.context.testDbName,
  });
});

test.serial('generate_db_records.main() uploads the expected number of entries to the database without variance', async (t) => {
  t.timeout(100 * 1000);
  const argv = clone(process.argv);
  const env = clone(process.env);
  process.env = localStackConnectionEnv;
  process.env.PG_DATABASE = t.context.testDbName;
  process.argv = process.argv.slice(0, 2).concat([
    '--concurrency=100',
    '-g=1',
    '--files=3',
    '--executionsPerGranule=4:5',
    '--collections=2',
  ]);
  await generate_db_records.main();
  const [{ count: collectionCount }] = await new CollectionPgModel().count(t.context.knex, []);
  t.is(Number(collectionCount), 2);
  const [{ count: granuleCount }] = await new GranulePgModel().count(t.context.knex, []);
  t.is(Number(granuleCount), 2000);
  const [{ count: executionCount }] = await new ExecutionPgModel().count(t.context.knex, []);
  t.is(Number(executionCount), 1600);
  const [{ count: fileCount }] = await new FilePgModel().count(t.context.knex, []);
  t.is(Number(fileCount), 6000);
  const [{
    count: granuleExecutionCount,
  }] = await new GranulesExecutionsPgModel().count(t.context.knex, []);
  t.is(Number(granuleExecutionCount), 8000);

  process.argv = argv;
  process.env = env;
});

test.serial('generate_db_records.main() uploads at least the expected number of entries to the database with variance', async (t) => {
  t.timeout(100 * 1000);
  const argv = clone(process.argv);
  const env = clone(process.env);
  process.env = localStackConnectionEnv;
  process.env.PG_DATABASE = t.context.testDbName;
  process.argv = process.argv.slice(0, 2).concat([
    '--concurrency=200',
    '-g=2',
    '--files=2',
    '--executionsPerGranule=2:4',
    '--collections=2',
    '--variance',
  ]);
  await generate_db_records.main();
  const [{ count: collectionCount }] = await new CollectionPgModel().count(t.context.knex, []);
  t.is(Number(collectionCount), 2);
  const [{ count: granuleCount }] = await new GranulePgModel().count(t.context.knex, []);
  t.true(Number(granuleCount) >= 4000);
  const [{ count: executionCount }] = await new ExecutionPgModel().count(t.context.knex, []);
  t.true(Number(executionCount) >= 2000);
  const [{ count: fileCount }] = await new FilePgModel().count(t.context.knex, []);
  t.true(Number(fileCount) >= 8000);
  const [{
    count: granuleExecutionCount,
  }] = await new GranulesExecutionsPgModel().count(t.context.knex, []);
  t.true(Number(granuleExecutionCount) >= 8000);

  process.argv = argv;
  process.env = env;
});


test.only('generate_db_executions.main() uploads at least the expected number of executions', async (t) => {
  t.timeout(100 * 1000);
  const argv = clone(process.argv);
  const env = clone(process.env);
  process.env = localStackConnectionEnv;
  process.env.PG_DATABASE = t.context.testDbName;
  process.argv = process.argv.slice(0, 2).concat([
    '--concurrency=200',
    '--executionsK=1',
    '--collections=2',
  ]);
  await generate_db_executions.main();
  const [{ count: collectionCount }] = await new CollectionPgModel().count(t.context.knex, []);
  t.is(Number(collectionCount), 2);

  const [{ count: executionCount }] = await new ExecutionPgModel().count(t.context.knex, []);
  t.is(Number(executionCount), 2000);


  process.argv = argv;
  process.env = env;
});
