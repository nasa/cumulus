import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  if (!await knex.schema.hasColumn('granules', 'active')) {
    await knex.schema.table('granules', (table) => {
      table
        .string('active', 1)
        .comment('Flag for active Status');
    });

    await knex('granules').update('active', 'A');

    await knex.schema.table('granules', (table) => {
      table.text('active').notNullable().alter();
    });
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
