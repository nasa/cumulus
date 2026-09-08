import { Knex } from 'knex';

const FUNCTION_NAME = 'granules_enforce_global_uniqueness';
const TRIGGER_NAME = 'granules_enforce_unique_granule_id_trigger';

export const up = async (knex: Knex): Promise<void> => {
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

  await knex.raw(`
    CREATE TRIGGER ${TRIGGER_NAME}
    BEFORE INSERT OR UPDATE OF granule_id OR DELETE
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
