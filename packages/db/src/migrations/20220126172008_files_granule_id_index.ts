import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  await knex.schema.table('files', (table) => {
    table.index('granule_cumulus_id');
  });
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.schema.table('files', (table) => {
    table.dropIndex('granule_cumulus_id');
  });
};
