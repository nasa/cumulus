import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  await knex.schema.table('files', (table) => {
    table
      .text('type')
      .comment('file "type"');
  });
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.schema.table('files', (table) => {
    table.dropColumn('type');
  });
};
