import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> =>
  await knex.schema.createTable('granule_duplicates', (table) => {
    table
      .increments('cumulus_id')
      .primary();
    table
      .integer('granule_cumulus_id')
      .references('cumulus_id')
      .inTable('granules')
      .notNullable();
    table
      .specificType('status', 'char(1)')
      .comment('Granule active status')
      .notNullable();
    table
      .string('group_id')
      .comment('Granule duplicate group id')
      .notNullable();
  });

export const down = async (knex: Knex): Promise<void> => await knex.schema
  .dropTableIfExists('granule_duplicates');
