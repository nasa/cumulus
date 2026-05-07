import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  await knex.schema.createTable('granules_global_unique', (table) => {
    table.text('granule_id').primary();
  });

  await knex.raw(`
    COMMENT ON TABLE granules_global_unique IS 'Global lookup table for granules uniqueness across partitions';
    COMMENT ON COLUMN granules_global_unique.granule_id IS 'Globally unique granule identifier';
  `);
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('granules_global_unique');
};
