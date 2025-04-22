import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  if (!await knex.schema.hasColumn('granules', 'producer_granule_id')) {

    await knex.schema.table('granules', (table) => {
      table
        .string('producer_granule_id')
        .comment('Producer Granule Id');
    });

    await knex('granules').update('producer_granule_id', knex.raw('granule_id'));

    await knex.schema.table('granules', (table) => {
      table.string('producer_granule_id').notNullable().alter();
    });
  }
};

export const down = async (knex: Knex): Promise<void> => {
  if (await knex.schema.hasColumn('granules', 'producer_granule_id')) {
    await knex.schema.table('granules', (table) => {
      table.dropColumn('producer_granule_id');
    });
  }
};
