import { Knex } from 'knex';
import { getPartitionCount } from '../lib/migration';

const DEFAULT_PARTITION_COUNT = 4;

export const up = async (knex: Knex): Promise<void> => {
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
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('files_global_unique');
};
