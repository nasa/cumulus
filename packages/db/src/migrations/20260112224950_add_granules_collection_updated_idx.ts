import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  await knex.raw('CREATE INDEX CONCURRENTLY IF NOT EXISTS granules_collection_updated_idx ON granules (collection_cumulus_id, updated_at)');
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS granules_collection_updated_idx');
};
exports.config = {
  transaction: false,
};
