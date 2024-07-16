  -- Add indexes on updated_at
  SELECT CURRENT_TIMESTAMP;
  CREATE INDEX CONCURRENTLY IF NOT EXISTS async_operations_update_at_index ON async_operations(updated_at);
  SELECT CURRENT_TIMESTAMP;
  CREATE INDEX CONCURRENTLY IF NOT EXISTS collections_update_at_index ON collections(updated_at);
  SELECT CURRENT_TIMESTAMP;
  CREATE INDEX CONCURRENTLY IF NOT EXISTS executions_update_at_index ON executions(updated_at);
  SELECT CURRENT_TIMESTAMP;
  CREATE INDEX CONCURRENTLY IF NOT EXISTS granules_update_at_index ON granules(updated_at);
  SELECT CURRENT_TIMESTAMP;
  CREATE INDEX CONCURRENTLY IF NOT EXISTS pdrs_update_at_index ON pdrs(updated_at);
  SELECT CURRENT_TIMESTAMP;
  CREATE INDEX CONCURRENTLY IF NOT EXISTS providers_update_at_index ON providers(updated_at);
  SELECT CURRENT_TIMESTAMP;
  CREATE INDEX CONCURRENTLY IF NOT EXISTS rules_update_at_index ON rules(updated_at);
  SELECT CURRENT_TIMESTAMP;

  -- Add indexes on foreign keys
  
