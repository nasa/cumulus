import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  await knex.raw('CREATE INDEX CONCURRENTLY IF NOT EXISTS executions_parent_cumulus_id_index ON executions(parent_cumulus_id)');
  await knex.raw('CREATE INDEX CONCURRENTLY IF NOT EXISTS executions_collection_cumulus_id_index ON executions(collection_cumulus_id)');
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS executions_parent_cumulus_id_index');
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS executions_collection_cumulus_id_index');
};
exports.config = {
  transaction: false,
};
