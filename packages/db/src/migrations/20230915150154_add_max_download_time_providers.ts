import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> =>
  await knex.schema.table('providers', (table) => {
    table
      .integer('max_download_time')
      .comment('Maximum download time in seconds for all files of a granule');
  });

export const down = async (knex: Knex): Promise<void> => {
  if (await knex.schema.hasColumn('providers', 'max_download_time')) {
    await knex.schema.table('providers', (table) => {
      table.dropColumn('max_download_time');
    });
  }
};
