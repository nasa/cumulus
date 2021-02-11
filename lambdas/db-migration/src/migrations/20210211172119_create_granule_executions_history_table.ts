import * as Knex from 'knex';

export const up = async (knex: Knex): Promise<void> =>
  knex.schema.createTable('granule_executions_history', (table) => {
    table
      .integer('granule_cumulus_id')
      .references('cumulus_id')
      .inTable('granules')
      .notNullable();
    table
      .integer('execution_cumulus_id')
      .references('cumulus_id')
      .inTable('executions')
      .notNullable();
    table
      .unique(['granule_cumulus_id', 'execution_cumulus_id']);
  });

export const down = async (knex: Knex): Promise<void> => knex.schema
  .dropTableIfExists('granule_executions_history');
