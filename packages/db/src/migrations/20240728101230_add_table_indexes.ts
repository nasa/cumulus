import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  await knex.raw('CREATE INDEX CONCURRENTLY IF NOT EXISTS async_operations_updated_at_index ON async_operations(updated_at)');
  await knex.raw('CREATE INDEX CONCURRENTLY IF NOT EXISTS async_operations_status_operation_type_cumulus_id_index ON async_operations(status, operation_type, cumulus_id)');

  await knex.raw('CREATE INDEX CONCURRENTLY IF NOT EXISTS collections_updated_at_index ON collections(updated_at)');

  await knex.raw('CREATE INDEX CONCURRENTLY IF NOT EXISTS executions_updated_at_index ON executions(updated_at)');
  await knex.raw('CREATE INDEX CONCURRENTLY IF NOT EXISTS executions_status_collection_cumulus_id_index ON executions(status, collection_cumulus_id, cumulus_id)');

  await knex.raw('CREATE INDEX CONCURRENTLY IF NOT EXISTS files_updated_at_index ON files(updated_at)');

  await knex.raw('CREATE INDEX CONCURRENTLY IF NOT EXISTS granules_updated_at_index ON granules(updated_at)');
  await knex.raw('CREATE INDEX CONCURRENTLY IF NOT EXISTS granules_coll_status_processendtime_cumulus_id_index ON granules(collection_cumulus_id, status, processing_end_date_time, cumulus_id)');
  await knex.raw('CREATE INDEX CONCURRENTLY IF NOT EXISTS granules_status_provider_collection_cumulus_id_index ON granules(status, provider_cumulus_id, collection_cumulus_id, cumulus_id)');

  await knex.raw('CREATE INDEX CONCURRENTLY IF NOT EXISTS pdrs_updated_at_index ON pdrs(updated_at)');
  await knex.raw('CREATE INDEX CONCURRENTLY IF NOT EXISTS pdrs_status_provider_collection_cumulus_id_index ON pdrs(status, provider_cumulus_id, collection_cumulus_id, cumulus_id)');
  await knex.raw('CREATE INDEX CONCURRENTLY IF NOT EXISTS pdrs_execution_cumulus_id_index ON pdrs(execution_cumulus_id)');
  await knex.raw('CREATE INDEX CONCURRENTLY IF NOT EXISTS pdrs_coll_status_cumulus_id_index ON pdrs(collection_cumulus_id, status, cumulus_id)');

  await knex.raw('CREATE INDEX CONCURRENTLY IF NOT EXISTS providers_updated_at_index ON providers(updated_at)');

  await knex.raw('CREATE INDEX CONCURRENTLY IF NOT EXISTS rules_updated_at_index ON rules(updated_at)');

  await knex.raw('VACUUM (ANALYZE, VERBOSE) async_operations');
  await knex.raw('VACUUM (ANALYZE, VERBOSE) collections');
  await knex.raw('VACUUM (ANALYZE, VERBOSE) executions');
  await knex.raw('VACUUM (ANALYZE, VERBOSE) files');
  await knex.raw('VACUUM (ANALYZE, VERBOSE) granules');
  await knex.raw('VACUUM (ANALYZE, VERBOSE) pdrs');
  await knex.raw('VACUUM (ANALYZE, VERBOSE) providers');
  await knex.raw('VACUUM (ANALYZE, VERBOSE) rules');
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS async_operations_updated_at_index');
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS async_operations_status_operation_type_cumulus_id_index');

  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS collections_updated_at_index');

  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS executions_updated_at_index');
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS executions_status_collection_cumulus_id_index');

  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS files_updated_at_index');

  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS granules_updated_at_index');
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS granules_coll_status_processendtime_cumulus_id_index');
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS granules_status_provider_collection_cumulus_id_index');

  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS pdrs_updated_at_index');
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS pdrs_status_provider_collection_cumulus_id_index');
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS pdrs_execution_cumulus_id_index');
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS pdrs_coll_status_cumulus_id_index');

  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS providers_updated_at_index');

  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS rules_updated_at_index');
};
exports.config = {
  transaction: false,
};
