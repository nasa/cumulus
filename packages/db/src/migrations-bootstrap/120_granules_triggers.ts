import { Knex } from 'knex';

const FUNCTION_NAME = 'granules_enforce_global_uniqueness';
const TRIGGER_NAME = 'granules_enforce_unique_granule_id_trigger';

export const up = async (knex: Knex): Promise<void> => {
  await knex.raw(`
    CREATE OR REPLACE FUNCTION ${FUNCTION_NAME}() RETURNS trigger AS $$
    /*
     * HIGH-LEVEL ARCHITECTURE & BUSINESS LOGIC:
     * Enforces global uniqueness for 'granule_id' using a side-table ('granules_global_unique')
     * to eliminate expensive lookups against the granules table.
     *
     * CONSTRAINTS:
     * 1. Don't insert granule when granule_id already exists.
     * 2. Don't update granule when granule_id exists with another collection_cumulus_id unless explicitly allowed.
     * 3. Allow collection updates only when 'cumulus.allow_collection_update' is set to 'true'.
     *
     * STRATEGIES:
     * - DELETES: Removes tracking rows immediately.
     * - INSERTS/UPDATES: Performs direct inserts. Handles changes by cleaning old IDs.
     *   Traps 'unique_violation' to allow safe updates but throws a descriptive error on collisions.
     */
    DECLARE
      allow_collection_update text;
    BEGIN
      SELECT current_setting('cumulus.allow_collection_update', true) INTO allow_collection_update;

      -- Handle Deletes
      IF (TG_OP = 'DELETE') THEN
        DELETE FROM granules_global_unique WHERE granule_id = OLD.granule_id;
        RETURN OLD;
      END IF;

      -- Handle granule_id mutations on UPDATE (Free old ID if it changes)
      IF (TG_OP = 'UPDATE' AND OLD.granule_id IS DISTINCT FROM NEW.granule_id) THEN
        DELETE FROM granules_global_unique WHERE granule_id = OLD.granule_id;
      END IF;

      -- Handle Inserts and Updates
      IF (TG_OP IN ('INSERT', 'UPDATE')) THEN
        BEGIN
          INSERT INTO granules_global_unique (granule_id)
          VALUES (NEW.granule_id);
        EXCEPTION WHEN unique_violation THEN
          -- Allow update if granule_id matches AND either collection hasn't changed OR explicit permission is granted
          IF (TG_OP = 'UPDATE' AND OLD.granule_id = NEW.granule_id) THEN
            IF (OLD.collection_cumulus_id = NEW.collection_cumulus_id OR allow_collection_update = 'true') THEN
              RETURN NEW;
            END IF;
          END IF;

          RAISE UNIQUE_VIOLATION USING MESSAGE = format(
            'duplicate key value violates unique constraint on granule_id "%s" in collection "%s"',
            NEW.granule_id,
            NEW.collection_cumulus_id
          );
        END;
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await knex.raw(`
    CREATE TRIGGER ${TRIGGER_NAME}
    BEFORE INSERT OR UPDATE OF granule_id, collection_cumulus_id OR DELETE
    ON granules
    FOR EACH ROW
    EXECUTE FUNCTION ${FUNCTION_NAME}();
  `);
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.raw(`
    DROP TRIGGER IF EXISTS ${TRIGGER_NAME} ON granules;
    DROP FUNCTION IF EXISTS ${FUNCTION_NAME}();
  `);
};
