import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  await knex.raw('CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS granules_collection_cumulus_id_granule_id_unique ON granules(collection_cumulus_id, granule_id)');
  await knex.raw('CREATE INDEX CONCURRENTLY IF NOT EXISTS granules_granule_id_index ON granules(granule_id)');
  await knex.raw('CREATE INDEX CONCURRENTLY IF NOT EXISTS granules_provider_collection_cumulus_id_granule_id_index ON granules(provider_cumulus_id, collection_cumulus_id, granule_id)');
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.raw('DROP INDEX IF EXISTS granules_collection_cumulus_id_granule_id_unique');
  await knex.raw('DROP INDEX IF EXISTS granules_granule_id_index');
  await knex.raw('DROP INDEX IF EXISTS granules_provider_cumulus_id_index');
};

exports.config = {
  transaction: false,
};
