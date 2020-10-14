import * as Knex from 'knex';

export const up = async (knex: Knex): Promise<void> =>
  knex.schema.createTable('executions', (table) => {
    table
      .increments('cumulusId')
      .primary();
    table
      .integer('asyncOperationsCumulusId')
      .references('cumulusId')
      .inTable('asyncOperations')
      .notNullable();
    table
      .integer('collectionCumulusId')
      .references('cumulusId')
      .inTable('collections')
      .notNullable();
    table
      .timestamps(false, true);
    table.unique(['name']);
  });

export const down = async (knex: Knex): Promise<void> => knex.schema
  .dropTableIfExists('executions');
