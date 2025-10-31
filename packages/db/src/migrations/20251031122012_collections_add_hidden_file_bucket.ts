import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  if (!await knex.schema.hasColumn('collections', 'hidden_file_bucket')) {
    await knex.schema.table('collections', (table) => {
      table
        .text('hidden_file_bucket')
        .comment('Bucket for hidden granule files');
    });
  }
};

export const down = async (knex: Knex): Promise<void> => {
  if (await knex.schema.hasColumn('collections', 'hidden_file_bucket')) {
    await knex.schema.table('collections', (table) => {
      table.dropColumn('hidden_file_bucket');
    });
  }
};
