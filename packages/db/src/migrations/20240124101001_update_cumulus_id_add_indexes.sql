-- Update column types
SELECT CURRENT_TIMESTAMP;
ALTER TABLE executions ALTER COLUMN cumulus_id TYPE BIGINT, ALTER COLUMN parent_cumulus_id TYPE BIGINT;
SELECT CURRENT_TIMESTAMP;
ALTER TABLE files ALTER COLUMN granule_cumulus_id TYPE BIGINT;
SELECT CURRENT_TIMESTAMP;
ALTER TABLE granules_executions ALTER COLUMN granule_cumulus_id TYPE BIGINT, ALTER COLUMN execution_cumulus_id TYPE BIGINT;
SELECT CURRENT_TIMESTAMP;
ALTER TABLE pdrs ALTER COLUMN execution_cumulus_id TYPE BIGINT;
SELECT CURRENT_TIMESTAMP;

VACUUM (ANALYZE, VERBOSE) executions;
SELECT CURRENT_TIMESTAMP;
VACUUM (ANALYZE, VERBOSE) files;
SELECT CURRENT_TIMESTAMP;
VACUUM (ANALYZE, VERBOSE) granules_executions;
SELECT CURRENT_TIMESTAMP;
VACUUM (ANALYZE, VERBOSE) pdrs;
SELECT CURRENT_TIMESTAMP;

-- Update and Add indexes
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS granules_collection_cumulus_id_granule_id_unique ON granules(collection_cumulus_id, granule_id);
SELECT CURRENT_TIMESTAMP;
CREATE INDEX CONCURRENTLY IF NOT EXISTS granules_granule_id_index ON granules(granule_id);
SELECT CURRENT_TIMESTAMP;
CREATE INDEX CONCURRENTLY IF NOT EXISTS granules_provider_collection_cumulus_id_granule_id_index ON granules(provider_cumulus_id, collection_cumulus_id, granule_id);
SELECT CURRENT_TIMESTAMP;
