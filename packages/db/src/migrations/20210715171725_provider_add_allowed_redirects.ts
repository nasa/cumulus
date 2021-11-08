import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> =>
  await knex.schema.table('providers', (table) => {
    table
      .specificType('allowed_redirects', 'text ARRAY')
      .comment('Only hosts in this list will have the provider username/password forwarded for authentication. Entries should be specified as host.com or host.com:7000 if redirect port is different than the provider port.');
  });

export const down = async (knex: Knex): Promise<void> => {
  if (await knex.schema.hasColumn('providers', 'allowed_redirects')) {
    await knex.schema.table('providers', (table) => {
      table.dropColumn('allowed_redirects');
    });
  }
};
