import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  await knex.schema.table('collections', (table) => {
    table
      .text('data_type')
      .comment('data type');
  });
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.schema.table('collections', (table) => {
    table.dropColumn('data_type');
  });
};
