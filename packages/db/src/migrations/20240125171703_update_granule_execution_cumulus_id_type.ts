import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  await knex.raw('ALTER TABLE files ALTER COLUMN granule_cumulus_id TYPE BIGINT');
  await knex.raw('ALTER TABLE executions ALTER COLUMN cumulus_id TYPE BIGINT, ALTER COLUMN parent_cumulus_id TYPE BIGINT');
  await knex.raw('ALTER TABLE granules_executions ALTER COLUMN granule_cumulus_id TYPE BIGINT, ALTER COLUMN execution_cumulus_id TYPE BIGINT');
  await knex.raw('ALTER TABLE pdrs ALTER COLUMN execution_cumulus_id TYPE BIGINT');
};

export const down = async (): Promise<void> => {
  console.log('Warning - this migration cannot be rolled back');
};
