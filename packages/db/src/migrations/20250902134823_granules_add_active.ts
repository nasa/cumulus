import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  if (!await knex.schema.hasColumn('granules', 'active')) {
    await knex.schema.table('granules', (table) => {
      table
        .boolean('active')
        .comment('Active Status');
    });

    await knex('granules').update('active', true);
  }

  await knex.raw('CREATE INDEX CONCURRENTLY IF NOT EXISTS granules_active_index ON granules(active)');
};

export const down = async (knex: Knex): Promise<void> => {
  if (await knex.schema.hasColumn('granules', 'active')) {
    await knex.schema.table('granules', (table) => {
      table.dropColumn('active');
    });
  }
};

exports.config = {
  transaction: false,
};
