-- Verify that there are no duplicate granule_id values in the granules table
SELECT 'Verifying there are no duplicate granule_id values in the table ' || clock_timestamp() AS message;
DO $$
DECLARE
  duplicate_found BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT granule_id
    FROM granules
    GROUP BY granule_id
    HAVING COUNT(*) > 1
    LIMIT 1
  ) INTO duplicate_found;

  IF duplicate_found THEN
    RAISE EXCEPTION 'Duplicate granule_id found. Exiting.';
  END IF;
END $$;

-- Add a new producer_granule_id column (nullable for now) to the granules table
SELECT 'Adding a new producer_granule_id column ' || clock_timestamp() AS message;
ALTER TABLE granules
ADD COLUMN producer_granule_id TEXT;

COMMENT ON COLUMN granules.producer_granule_id IS 'Producer Granule Id';

-- Populate the producer_granule_id column in batches with values from the granule_id column
SELECT 'Populating producer_granule_id column ' || clock_timestamp() AS message;
DO $$
DECLARE
  batch_size INTEGER := 100000;
  min_cumulus_id BIGINT := 0;
  max_cumulus_id BIGINT;
BEGIN
  SELECT MIN(cumulus_id), MAX(cumulus_id)
  INTO min_cumulus_id, max_cumulus_id
  FROM granules;

  RAISE NOTICE 'Initial max_cumulus_id: %, min_cumulus_id: % at %', max_cumulus_id, min_cumulus_id, clock_timestamp();

  -- Loop in batches until all rows are updated
  WHILE min_cumulus_id <= max_cumulus_id LOOP
    UPDATE granules
    SET producer_granule_id = granule_id
    WHERE cumulus_id BETWEEN min_cumulus_id AND min_cumulus_id + batch_size - 1;

    min_cumulus_id := min_cumulus_id + batch_size;

    RAISE NOTICE 'Processing up to cumulus_id: % at %', min_cumulus_id, clock_timestamp();
  END LOOP;
  RAISE NOTICE 'Completed populating new column at %', clock_timestamp();
END $$;

-- Set NOT NULL constraint after confirming all rows are filled
SELECT 'Setting producer_granule_id column to NOT NULL ' || clock_timestamp() AS message;
ALTER TABLE granules
ALTER COLUMN producer_granule_id SET NOT NULL;

-- Create index concurrently (must not be inside a transaction)
SELECT 'Creating index ' || clock_timestamp() AS message;
CREATE INDEX CONCURRENTLY IF NOT EXISTS granules_producer_granule_id_index
ON granules(producer_granule_id);

SELECT 'Creating index completed at ' || clock_timestamp() AS message;
