import * as Knex from 'knex';

export const up = async (knex: Knex): Promise<void> =>
  knex.schema.createTable('asyncOperations', (table) => {
    table
      .increments('cumulusId')
      .primary();
    table
      .uuid('id')
      .comment('Unique ID for async operation');
    table
      .timestamps(false, true);
    table.unique(['id']);
  });

export const down = async (knex: Knex): Promise<void> => knex.schema
  .dropTableIfExists('asyncOperations');
