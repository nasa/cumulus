import { Knex } from 'knex';

const FUNCTION_NAME_PREFIX = 'granules_enforce_global_uniqueness';
const TRIGGER_NAME_PREFIX = 'granules_enforce_unique_granule_id_trigger';

export const up = async (knex: Knex): Promise<void> => {
  await knex.raw(`
    DROP TRIGGER IF EXISTS ${TRIGGER_NAME_PREFIX} ON granules;
    DROP FUNCTION IF EXISTS ${FUNCTION_NAME_PREFIX}();
  `);

  // DELETE FUNCTION & TRIGGER
  await knex.raw(`
    CREATE OR REPLACE FUNCTION ${FUNCTION_NAME_PREFIX}_delete() RETURNS trigger AS $$
    BEGIN
      DELETE FROM granules_global_unique WHERE granule_id = OLD.granule_id;
      RETURN OLD;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await knex.raw(`
    CREATE TRIGGER ${TRIGGER_NAME_PREFIX}_delete
    BEFORE DELETE ON granules
    FOR EACH ROW
    EXECUTE FUNCTION ${FUNCTION_NAME_PREFIX}_delete();
  `);

  // INSERT FUNCTION & TRIGGER
  await knex.raw(`
    CREATE OR REPLACE FUNCTION ${FUNCTION_NAME_PREFIX}_insert() RETURNS trigger AS $$
    BEGIN
      INSERT INTO granules_global_unique (granule_id)
      VALUES (NEW.granule_id);
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await knex.raw(`
    CREATE TRIGGER ${TRIGGER_NAME_PREFIX}_insert
    BEFORE INSERT ON granules
    FOR EACH ROW
    EXECUTE FUNCTION ${FUNCTION_NAME_PREFIX}_insert();
  `);

  // UPDATE FUNCTION & TRIGGER
  await knex.raw(`
    CREATE OR REPLACE FUNCTION ${FUNCTION_NAME_PREFIX}_update() RETURNS trigger AS $$
    BEGIN
      -- If granule_id changed, remove tracking row for the old ID to prevent orphaned records
      IF (OLD.granule_id IS DISTINCT FROM NEW.granule_id) THEN
        DELETE FROM granules_global_unique WHERE granule_id = OLD.granule_id;
      END IF;

      -- Allow update if granule_id is unchanged and collection matches
      IF OLD.granule_id = NEW.granule_id AND OLD.collection_cumulus_id = NEW.collection_cumulus_id THEN
        RETURN NEW;

      -- Allow update if granule_id is unchanged and allow_collection_update is set to true
      ELSIF OLD.granule_id = NEW.granule_id
        -- Fetch run-time configuration; missing_ok is true, returns NULL if missing
        AND current_setting('cumulus.allow_collection_update', true) = 'true'
      THEN
        RETURN NEW;
      END IF;

      INSERT INTO granules_global_unique (granule_id)
      VALUES (NEW.granule_id);

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await knex.raw(`
    CREATE TRIGGER ${TRIGGER_NAME_PREFIX}_update
    BEFORE UPDATE OF granule_id, collection_cumulus_id ON granules
    FOR EACH ROW
    EXECUTE FUNCTION ${FUNCTION_NAME_PREFIX}_update();
  `);
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.raw(`DROP TRIGGER IF EXISTS ${TRIGGER_NAME_PREFIX}_delete ON granules;`);
  await knex.raw(`DROP TRIGGER IF EXISTS ${TRIGGER_NAME_PREFIX}_insert ON granules;`);
  await knex.raw(`DROP TRIGGER IF EXISTS ${TRIGGER_NAME_PREFIX}_update ON granules;`);

  await knex.raw(`DROP FUNCTION IF EXISTS ${FUNCTION_NAME_PREFIX}_delete();`);
  await knex.raw(`DROP FUNCTION IF EXISTS ${FUNCTION_NAME_PREFIX}_insert();`);
  await knex.raw(`DROP FUNCTION IF EXISTS ${FUNCTION_NAME_PREFIX}_update();`);
  await knex.raw(`
    CREATE OR REPLACE FUNCTION ${FUNCTION_NAME_PREFIX}()
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

  await knex.raw(`
    CREATE TRIGGER ${TRIGGER_NAME_PREFIX}
    BEFORE INSERT OR UPDATE OF granule_id OR DELETE
    ON granules
    FOR EACH ROW
    EXECUTE FUNCTION ${FUNCTION_NAME_PREFIX}();
  `);
};
