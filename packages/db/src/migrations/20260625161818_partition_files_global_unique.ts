import { Knex } from 'knex';
import { getPartitionCount } from '../lib/migration';

const DEFAULT_PARTITION_COUNT = 4;

export const up = async (knex: Knex): Promise<void> => {
  const oldTableName = 'files_global_unique_old_non_partitioned';
  const oldPkeyName = 'files_global_unique_pkey_old_non_partitioned';
  const MIGRATION_ROW_COUNT_THRESHOLD = 1000000;

  // check if the table is already partitioned
  const partitionCheck = await knex.raw(`
    SELECT 1
    FROM pg_class c
    JOIN pg_partitioned_table p ON c.oid = p.partrelid
    WHERE c.relname = 'files_global_unique';
  `);

  if (partitionCheck.rows.length > 0) {
    return;
  }

  // check row count to decide if we migrate immediately and drop the old table
  const countCheck = await knex.raw(`
    SELECT reltuples::bigint AS estimated_count
    FROM pg_class
    WHERE relname = 'files_global_unique';
  `);

  const estimatedRows = countCheck.rows?.estimated_count ?? 0;
  const shouldMigrate = estimatedRows < MIGRATION_ROW_COUNT_THRESHOLD;

  await knex.raw(`ALTER TABLE files_global_unique RENAME TO ${oldTableName};`);
  await knex.raw(`ALTER TABLE ${oldTableName} RENAME CONSTRAINT files_global_unique_pkey TO ${oldPkeyName};`);

  // Create the new partitioned table
  const PARTITION_COUNT: number = getPartitionCount(
    'FILES_GLOBAL_UNIQUE_PARTITION_COUNT', DEFAULT_PARTITION_COUNT
  );

  await knex.raw(`
    CREATE TABLE files_global_unique (
      bucket TEXT NOT NULL,
      key TEXT NOT NULL,
      CONSTRAINT files_global_unique_pkey PRIMARY KEY (bucket, key)
    ) PARTITION BY HASH (bucket, key);
  `);

  await Promise.all(
    Array.from({ length: PARTITION_COUNT }).map((_, i) =>
      knex.raw(`
        CREATE TABLE files_global_unique_p${i}
        PARTITION OF files_global_unique
        FOR VALUES WITH (MODULUS ${PARTITION_COUNT}, REMAINDER ${i});
      `))
  );

  await knex.raw(`
    COMMENT ON TABLE files_global_unique IS 'Global lookup table for files uniqueness across partitions';
    COMMENT ON COLUMN files_global_unique.bucket IS 'AWS S3 bucket';
    COMMENT ON COLUMN files_global_unique.key IS 'AWS S3 object key';
  `);

  // perform migration and drop old table, or leave old table for manual migration
  if (shouldMigrate) {
    await knex.raw(`
      INSERT INTO files_global_unique (bucket, key)
      SELECT bucket, key FROM ${oldTableName}
      ON CONFLICT DO NOTHING;
    `);
    await knex.raw(`DROP TABLE ${oldTableName};`);
  } else {
    await knex.raw(`
      COMMENT ON TABLE ${oldTableName} IS 'Backup of un-migrated unique file lookup records';
    `);
  }
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('files_global_unique');
};
