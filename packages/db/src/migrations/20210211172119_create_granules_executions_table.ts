import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> =>
  await knex.schema.createTable('granules_executions', (table) => {
    table
      .integer('granule_cumulus_id')
      .notNullable();
    table.foreign('granule_cumulus_id')
      .references('cumulus_id')
      .inTable('granules')
      .onDelete('CASCADE');
    table
      .integer('execution_cumulus_id')
      .notNullable();
    table.foreign('execution_cumulus_id')
      .references('cumulus_id')
      .inTable('executions')
      .onDelete('CASCADE');
    table
      .unique(['granule_cumulus_id', 'execution_cumulus_id']);
  });

export const down = async (knex: Knex): Promise<void> => await knex.schema
  .dropTableIfExists('granules_executions');
