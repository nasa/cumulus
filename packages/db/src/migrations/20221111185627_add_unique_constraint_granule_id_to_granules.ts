import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  await knex.raw('ALTER TABLE granules ADD CONSTRAINT granule_id UNIQUE (granule_id);')
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.raw('ALTER TABLE granules DROP CONSTRAINT IF EXISTS granule_id')
};
