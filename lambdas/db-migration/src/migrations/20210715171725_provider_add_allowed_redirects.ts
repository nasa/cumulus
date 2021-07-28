import * as Knex from 'knex';

export const up = async (knex: Knex): Promise<void> =>
  await knex.schema.table('providers', (table) => {
    table
      .specificType('allowed_redirects', 'text ARRAY')
      .comment('Allowed hosts for redirect when retrieving data. If a redirect outside of this list is encountered, data retrival will fail.');
  });

export const down = async (knex: Knex): Promise<void> => {
  if (await knex.schema.hasColumn('providers', 'allowed_redirects')) {
    await knex.schema.table('providers', (table) => {
      table.dropColumn('allowed_redirects');
    });
  }
};
