import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  await knex.schema.createTable('executions_lookup', (table) => {
    // Primary key (global)
    table.bigIncrements('cumulus_id').primary();

    // Business identifiers
    table.text('arn').notNullable();
    table.text('url');

    // Enforce global uniqueness
    table.unique(['arn']);
    table.unique(['url']);
  });

  // Comments (keep separate as you prefer)
  await knex.raw(`
    COMMENT ON TABLE executions_lookup IS 'Global lookup table for executions primary and unique keys';
    COMMENT ON COLUMN executions_lookup.cumulus_id IS 'Global primary key for executions';
    COMMENT ON COLUMN executions_lookup.arn IS 'Execution ARN (globally unique)';
    COMMENT ON COLUMN executions_lookup.url IS 'Execution URL (globally unique)';
  `);
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('executions_lookup');
};
