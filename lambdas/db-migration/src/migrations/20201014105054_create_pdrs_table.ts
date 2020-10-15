import * as Knex from 'knex';

export const up = async (knex: Knex): Promise<void> =>
  knex.schema.createTable('pdrs', (table) => {
    table
      .increments('cumulusId')
      .primary();
    table
      .text('name')
      .comment('PDR name')
      .notNullable();
    table
      .integer('collectionCumulusId')
      .references('cumulusId')
      .inTable('collections')
      .notNullable();
    table
      .integer('providerCumulusId')
      .references('cumulusId')
      .inTable('providers')
      .notNullable();
    table
      .integer('executionCumulusId')
      .references('cumulusId')
      .inTable('executions')
      .notNullable();
    table
      .timestamps(false, true);
    table.unique(['name']);
  });

export const down = async (knex: Knex): Promise<void> => knex.schema
  .dropTableIfExists('pdrs');
