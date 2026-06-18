const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const range = require('lodash/range');
const {
  CollectionPgModel,
  ExecutionPgModel,
  GranulePgModel,
  GranulesExecutionsPgModel,
  PdrPgModel,
  ProviderPgModel,
  fakeCollectionRecordFactory,
  fakeExecutionRecordFactory,
  fakeGranuleRecordFactory,
  fakeProviderRecordFactory,
  fakePdrRecordFactory,
  generateLocalTestDb,
  destroyLocalTestDb,
  migrationDir,
} = require('../../dist');

const DELETE_EXPIRED_PARTITIONS_PROC_NAME = 'delete_expired_executions_partitions';
const testDbName = `test_executions_procs_${cryptoRandomString({ length: 10 })}`;

test.before(async (t) => {
  const { knexAdmin, knex } = await generateLocalTestDb(testDbName, migrationDir);
  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;

  t.context.collectionPgModel = new CollectionPgModel();
  t.context.executionPgModel = new ExecutionPgModel();
  t.context.granulePgModel = new GranulePgModel();
  t.context.granulesExecutionsPgModel = new GranulesExecutionsPgModel();
  t.context.pdrPgModel = new PdrPgModel();
  t.context.providerPgModel = new ProviderPgModel();
});

test.after.always(async (t) => {
  await destroyLocalTestDb({
    ...t.context,
    testDbName,
  });
});

test.serial('expired execution partitions are purged while explicitly keeping unexpired rows intact', async (t) => {
  const { knex } = t.context;
  const currentYear = new Date().getFullYear();
  const defaultPartitionName = 'executions_default';

  // Seed parent entities for integrity constrains
  const [pgCollection] = await t.context.collectionPgModel.insert(knex, fakeCollectionRecordFactory(), ['cumulus_id']);
  const [pgGranule] = await t.context.granulePgModel.insert(knex, fakeGranuleRecordFactory({ collection_cumulus_id: pgCollection.cumulus_id }), ['cumulus_id']);
  const [pgProvider] = await t.context.providerPgModel.insert(knex, fakeProviderRecordFactory(), ['cumulus_id']);

  // Define full list of expired partitions and explicit keeper partition
  const partitionsToSeed = [
    { name: 'executions_custom_old_data', start: `${currentYear - 5}-05-01`, end: `${currentYear - 5}-06-01`, arn: 'arn:aws:states:us-east-1:123456789012:execution:expired-5years', isExpired: true },
    { name: `executions_${currentYear - 4}_q1`, start: `${currentYear - 4}-01-01`, end: `${currentYear - 4}-04-01`, arn: 'arn:aws:states:us-east-1:123456789012:execution:expired-4years', isExpired: true },
    { name: `executions_${currentYear - 3}_q2`, start: `${currentYear - 3}-04-01`, end: `${currentYear - 3}-07-01`, arn: 'arn:aws:states:us-east-1:123456789012:execution:expired-3years', isExpired: true },
    { name: `executions_${currentYear - 1}_q3`, start: `${currentYear - 1}-07-01`, end: `${currentYear - 1}-10-01`, arn: 'arn:aws:states:us-east-1:123456789012:execution:keep-1year-old', isExpired: false },
  ];

  const BATCH_SEED_SIZE = 500;

  await Promise.all(
    partitionsToSeed.map(async (part, partIdx) => {
      await knex.raw(`
        CREATE TABLE IF NOT EXISTS ${part.name} PARTITION OF executions
        FOR VALUES FROM ('${part.start}') TO ('${part.end}');
      `);

      if (part.isExpired) {
        // High range offset (900000) guarantees no overlaps with auto-increment IDs
        const offset = 900000 + partIdx * BATCH_SEED_SIZE;
        const executionRecords = range(BATCH_SEED_SIZE).map((num) => {
          const globalId = offset + num;
          return fakeExecutionRecordFactory({
            cumulus_id: globalId,
            arn: `${part.arn}-${num}`,
            url: `https://example.com${part.name}/${num}`,
            created_at: part.start,
            status: 'failed',
          });
        });
        await t.context.executionPgModel.insert(
          knex,
          executionRecords,
          ['cumulus_id', 'created_at']
        );

        // Seed dependent child table constraints
        const granulesExecutionsRecords = range(BATCH_SEED_SIZE).map((num) => ({
          execution_cumulus_id: offset + num,
          execution_created_at: part.start,
          granule_cumulus_id: pgGranule.cumulus_id,
          collection_cumulus_id: pgCollection.cumulus_id,
        }));

        await t.context.granulesExecutionsPgModel.insert(knex, granulesExecutionsRecords);

        const pdrRecords = range(BATCH_SEED_SIZE).map((num) => {
          const globalId = offset + num;
          return fakePdrRecordFactory({
            name: `pdr-${globalId}`,
            execution_cumulus_id: globalId,
            execution_created_at: part.start,
            collection_cumulus_id: pgCollection.cumulus_id,
            provider_cumulus_id: pgProvider.cumulus_id,
            status: 'failed',
          });
        });

        await t.context.pdrPgModel.insert(knex, pdrRecords);
      } else {
        // Seed a single keeper control record
        const [unexpiredExec] = await t.context.executionPgModel.insert(
          knex,
          fakeExecutionRecordFactory({
            arn: part.arn,
            url: `https://example.com${part.name}`,
            created_at: part.start,
            status: 'completed',
          }),
          ['cumulus_id', 'created_at']
        );

        await t.context.granulesExecutionsPgModel.insert(
          knex,
          {
            execution_cumulus_id: unexpiredExec.cumulus_id,
            execution_created_at: unexpiredExec.created_at,
            granule_cumulus_id: pgGranule.cumulus_id,
            collection_cumulus_id: pgCollection.cumulus_id,
          }
        );

        await t.context.pdrPgModel.insert(
          knex,
          fakePdrRecordFactory({
            collection_cumulus_id: pgCollection.cumulus_id,
            execution_cumulus_id: unexpiredExec.cumulus_id,
            provider_cumulus_id: pgProvider.cumulus_id,
          })
        );
      }
    })
  );

  const totalExpiredPartitions = partitionsToSeed.filter((p) => p.isExpired).length;
  const expectedTotalExpiredRows = totalExpiredPartitions * BATCH_SEED_SIZE;
  const expectedTotalRows = expectedTotalExpiredRows + 1;

  const [[uniqueBefore], [execBefore], [joinBefore], [pdrBefore]] = await Promise.all([
    knex('executions_global_unique').count('arn as count'),
    knex('executions').count('cumulus_id as count'),
    knex('granules_executions').count('execution_cumulus_id as count'),
    knex('pdrs').count('cumulus_id as count'),
  ]);

  t.is(Number(uniqueBefore.count), expectedTotalRows);
  t.is(Number(execBefore.count), expectedTotalRows);
  t.is(Number(joinBefore.count), expectedTotalRows);
  t.is(Number(pdrBefore.count), expectedTotalRows);

  const retentionMonthsPast = 25;
  const deletionBatchSize = 50;

  await knex.raw(`CALL ${DELETE_EXPIRED_PARTITIONS_PROC_NAME}(?, ?);`, [retentionMonthsPast, deletionBatchSize]);

  await Promise.all(
    partitionsToSeed.map(async (part) => {
      const tableCheck = await knex.raw('SELECT to_regclass(?) as exists', [`${part.name}`]);

      if (part.isExpired) {
        t.falsy(tableCheck.rows[0].exists, `Expired partition ${part.name} should be dropped`);
      } else {
        t.truthy(tableCheck.rows[0].exists, `Unexpired partition ${part.name} must remain intact`);
      }
    })
  );

  const defaultCheck = await knex.raw('SELECT to_regclass(?) as exists', [defaultPartitionName]);
  t.truthy(defaultCheck.rows[0].exists, 'The default layout fallback table partition must remain untouched');

  const [[execAfter], [joinAfter], [pdrAfter], [uniqueAfter]] = await Promise.all([
    knex('executions').count('cumulus_id as count'),
    knex('granules_executions').count('execution_cumulus_id as count'),
    knex('pdrs').count('cumulus_id as count'),
    knex('executions_global_unique').count('arn as count'),
  ]);

  t.is(Number(execAfter.count), 1, 'Only unexpired control row must remain in main table');
  t.is(Number(joinAfter.count), 1, 'Only unexpired control mapping must remain in link table');
  t.is(Number(pdrAfter.count), 1, 'Only unexpired control tracking entry must remain in PDR table');
  t.is(Number(uniqueAfter.count), 1, 'Only unexpired global constraint tracking token must remain');

  const remainingExpiredUnique = await knex('executions_global_unique').whereLike('arn', '%:expired-%');
  t.is(remainingExpiredUnique.length, 0, 'All expired keys must be cleaned out of the global uniqueness lookup engine');
});

test.serial('procedure aborts safely when retention period is 0 or null', async (t) => {
  const { knex } = t.context;

  const currentYear = new Date().getFullYear();
  const oldPartitionName = 'executions_safeguard_test';

  // Seed historical partition
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS ${oldPartitionName} PARTITION OF executions
    FOR VALUES FROM ('${currentYear - 5}-07-01') TO ('${currentYear - 5}-10-01');
  `);

  await knex.raw(`CALL ${DELETE_EXPIRED_PARTITIONS_PROC_NAME}(?, ?);`, [0, 1000]);
  await knex.raw(`CALL ${DELETE_EXPIRED_PARTITIONS_PROC_NAME}(?);`, [null]);

  // Verify the old partition was NOT dropped because retention defaulted to null
  const tableCheck = await knex.raw(`
    SELECT to_regclass(?) as exists
  `, [oldPartitionName]);

  t.truthy(tableCheck.rows[0].exists, 'Table must remain intact when retention peroid is 0 or null');
});
