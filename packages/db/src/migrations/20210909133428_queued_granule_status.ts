import * as Knex from 'knex';

export const up = async (knex: Knex): Promise<void> =>
  await knex.schema.alterTable('granules', (table) => {
    table
      .enum('status', ['running', 'completed', 'failed', 'queued'])
      .comment('Ingest status of the granule')
      .notNullable();
  });

export const down = async (knex: Knex): Promise<void> => {
  await knex.schema.alterTable('granules', (table) => {
    table
      .enum('status', ['running', 'completed', 'failed'])
      .comment('Ingest status of the granule')
      .notNullable();
  });
};
