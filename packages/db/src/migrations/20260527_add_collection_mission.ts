import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  await knex.schema.alterTable('collection', (table) => {
    table.text('mission').notNullable();
  })
}

export const down = async (knex: Knex): Promise<void> => {
  await knex.schema.alterTable('collection', (table) => {
    table.dropColumn('mission');
  })
}
