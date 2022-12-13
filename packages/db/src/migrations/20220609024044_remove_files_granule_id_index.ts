import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  await knex.raw('DROP INDEX IF EXISTS files_granule_cumulus_id_index');
};

export const down = async (): Promise<void> => {
  console.log('Warning - this migration cannot be rolled back as 20220126172008_files_granule_id_index.ts was retroactively removed');
};
