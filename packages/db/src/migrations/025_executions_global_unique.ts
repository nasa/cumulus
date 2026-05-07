import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  await knex.schema.createTable('executions_global_unique', (table) => {
    table.text('arn').primary();
    table.text('url').unique();
  });

  await knex.raw(`
    COMMENT ON TABLE executions_global_unique IS 'Global lookup table for executions uniqueness across partitions';
    COMMENT ON COLUMN executions_global_unique.arn IS 'Execution ARN (globally unique)';
    COMMENT ON COLUMN executions_global_unique.url IS 'Execution URL (globally unique)';
  `);
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('executions_global_unique');
};
