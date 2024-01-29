import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  await knex.raw('ALTER TABLE granules ADD UNIQUE USING INDEX granules_collection_cumulus_id_granule_id_unique');
  await knex.raw('ALTER TABLE granules DROP constraint IF EXISTS granules_granule_id_collection_cumulus_id_unique');
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.raw('ALTER TABLE granules ADD CONSTRAINT granules_granule_id_collection_cumulus_id_unique UNIQUE (granule_id, collection_cumulus_id)');
  await knex.raw('ALTER TABLE granules DROP CONSTRAINT IF EXISTS granules_collection_cumulus_id_granule_id_unique');
};
