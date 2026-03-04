import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  if (!await knex.schema.hasColumn('collections', 'cmr_provider')) {
    await knex.schema.table('collections', (table) => {
      table.text('cmr_provider')
        .notNullable()
        .comment('CMR Provider for this collection');
    });
  }
  await knex.raw('CREATE INDEX CONCURRENTLY IF NOT EXISTS collection_cmr_provider_index ON collections(cmr_provider)');
};

export const down = async (knex: Knex): Promise<void> => {
  if (await knex.schema.hasColumn('collections', 'cmr_provider')) {
    await knex.schema.table('collections', (table) => {
      table.dropColumn('cmr_provider');
    });
  }
  await knex.raw('DROP INDEX IF EXISTS collection_cmr_provider_index');
};
