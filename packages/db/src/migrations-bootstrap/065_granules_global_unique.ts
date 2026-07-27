import { Knex } from 'knex';
import { getPartitionCount } from '../lib/migration';

const DEFAULT_PARTITION_COUNT = 2;

export const up = async (knex: Knex): Promise<void> => {
  const PARTITION_COUNT: number = getPartitionCount(
    'GRANULES_GLOBAL_UNIQUE_PARTITION_COUNT', DEFAULT_PARTITION_COUNT
  );

  await knex.raw(`
    CREATE TABLE granules_global_unique (
      granule_id TEXT NOT NULL,
      CONSTRAINT granules_global_unique_pkey PRIMARY KEY (granule_id)
    ) PARTITION BY HASH (granule_id);
  `);

  await Promise.all(
    Array.from({ length: PARTITION_COUNT }).map((_, i) =>
      knex.raw(`
        CREATE TABLE granules_global_unique_p${i}
        PARTITION OF granules_global_unique
        FOR VALUES WITH (MODULUS ${PARTITION_COUNT}, REMAINDER ${i});
      `))
  );

  await knex.raw(`
    COMMENT ON TABLE granules_global_unique IS 'Global lookup table for granules uniqueness across partitions';
    COMMENT ON COLUMN granules_global_unique.granule_id IS 'Globally unique granule identifier';
  `);
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('granules_global_unique');
};
