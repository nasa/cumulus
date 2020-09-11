import * as Knex from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  knex.schema.createTable('providers', (table) => {
    table
      .increments('cumulusId').primary();
  });
};

export const down = async (knex: Knex): Promise<void> => knex.schema
  .dropTableIfExists('providers');
