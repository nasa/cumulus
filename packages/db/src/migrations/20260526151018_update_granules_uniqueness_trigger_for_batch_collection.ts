import { Knex } from 'knex';

const FUNCTION_NAME = 'granules_enforce_global_uniqueness';
// TODO high level funtionality summary
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
     * - STANDARD PATH:
     *   - DELETES: Removes tracking rows immediately.
     *   - INSERTS/UPDATES: Performs direct inserts. Handles changes by cleaning old IDs.
     *     Traps 'unique_violation' to allow safe updates but throws a descriptive error on collisions,
     *     caller program validates cross-collection updates.
     *
     * - COLLECTION UPDATE PATH ('cumulus.allow_collection_update' = 'true'):
     *   - DELETES: Skipped to prevent removing rows that a companion partition insert will reuse.
     *   - INSERTS/UPDATES: Uses 'ON CONFLICT DO NOTHING' to allow fast partition-to-partition movement.
     */
    DECLARE
      allow_collection_update text;
    BEGIN
      SELECT current_setting('cumulus.allow_collection_update', true) INTO allow_collection_update;

      IF (TG_OP = 'DELETE') THEN
        IF allow_collection_update IS DISTINCT FROM 'true' THEN
          DELETE FROM granules_global_unique WHERE granule_id = OLD.granule_id;
        END IF;
        RETURN OLD;
      END IF;

      IF (TG_OP = 'UPDATE' AND OLD.granule_id IS DISTINCT FROM NEW.granule_id) THEN
        DELETE FROM granules_global_unique WHERE granule_id = OLD.granule_id;
      END IF;

      IF (TG_OP IN ('INSERT', 'UPDATE')) THEN
        IF allow_collection_update = 'true' THEN
          INSERT INTO granules_global_unique (granule_id)
          VALUES (NEW.granule_id)
          ON CONFLICT (granule_id) DO NOTHING;
        ELSE
          BEGIN
            INSERT INTO granules_global_unique (granule_id)
            VALUES (NEW.granule_id);
          EXCEPTION WHEN unique_violation THEN
            IF (TG_OP = 'UPDATE' AND OLD.granule_id = NEW.granule_id AND OLD.collection_cumulus_id = NEW.collection_cumulus_id) THEN
              RETURN NEW;
            END IF;
            RAISE UNIQUE_VIOLATION USING MESSAGE = format(
              'duplicate key value violates unique constraint on granule_id "%s" in collection "%s"',
              NEW.granule_id,
              NEW.collection_cumulus_id
            );
          END;
        END IF;
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.raw(`
    CREATE OR REPLACE FUNCTION ${FUNCTION_NAME}()
    RETURNS trigger AS $$
    DECLARE
      rows smallint;
    BEGIN
      IF (TG_OP IN ('DELETE', 'UPDATE')) THEN
        DELETE FROM granules_global_unique
        WHERE granule_id = OLD.granule_id;

        -- Don't block delete if guard row missing
        IF TG_OP = 'DELETE' THEN
          RETURN OLD;
        END IF;
      END IF;

      IF (TG_OP IN ('INSERT', 'UPDATE')) THEN
        INSERT INTO granules_global_unique (granule_id)
        VALUES (NEW.granule_id);
      END IF;

      GET DIAGNOSTICS rows = ROW_COUNT;

      IF rows != 1 THEN
        RAISE EXCEPTION '% affected % rows (expected: 1)', TG_OP, rows;
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
};
