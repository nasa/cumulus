import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  await knex.schema.alterTable('collections', (table) => {
    table.text('metrics_provider').notNullable();
  });
};

export const down = async (knex: Knex): Promise<void> => {
  if (await knex.schema.hasColumn('collections', 'metrics_provider')) {
    await knex.schema.alterTable('collections', (table) => {
      table.dropColumn('metrics_provider');
    });
  }
};
