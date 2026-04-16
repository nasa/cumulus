import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  await knex.schema.createTable('granules_lookup', (table) => {
    // Primary key (global)
    table.bigIncrements('cumulus_id').primary();

    // Business identifiers
    table.text('granule_id').notNullable();

    // Enforce global uniqueness
    table.unique(['granule_id']);
  });

  await knex.raw(`
    COMMENT ON TABLE granules_lookup IS 'Global lookup table for granules primary and unique keys';
    COMMENT ON COLUMN granules_lookup.cumulus_id IS 'Global primary key for granules';
    COMMENT ON COLUMN granules_lookup.granule_id IS 'Globally unique granule identifier';
  `);
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('granules_lookup');
};
