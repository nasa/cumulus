import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  if (!await knex.schema.hasColumn('collections', 'cmr_provider')) {
    await knex.schema.table('collections', (table) => {
      table.text('cmr_provider')
        .comment('CMR Provider for this collection');
    });
  }
};

export const down = async (knex: Knex): Promise<void> => {
  if (await knex.schema.hasColumn('collections', 'cmr_provider')) {
    await knex.schema.table('collections', (table) => {
      table.dropColumn('cmr_provider');
    });
  }
};
exports.config = {
  transaction: false,
};
