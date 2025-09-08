import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  if (!await knex.schema.hasColumn('granules', 'active_status')) {
    await knex.schema.alterTable('granules', (table) => {
      table.specificType('active_status', 'char(1)').notNullable().defaultTo('A');
    });

    await knex('granules').update('active_status', 'A');

    await knex.schema.table('granules', (table) => {
      table.text('active_status').notNullable().alter();
    });
  }

  await knex.raw('CREATE INDEX CONCURRENTLY IF NOT EXISTS granules_active_status_index ON granules(active_status)');
};

export const down = async (knex: Knex): Promise<void> => {
  if (await knex.schema.hasColumn('granules', 'active_status')) {
    await knex.schema.table('granules', (table) => {
      table.dropColumn('active_status');
    });
  }
};

exports.config = {
  transaction: false,
};
