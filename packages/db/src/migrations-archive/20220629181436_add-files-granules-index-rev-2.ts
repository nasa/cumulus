import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  await knex.raw('CREATE INDEX IF NOT EXISTS files_granule_cumulus_id_index ON files (granule_cumulus_id)');
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.raw('DROP INDEX IF EXISTS files_granule_cumulus_id_index');
};
