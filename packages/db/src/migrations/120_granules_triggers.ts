import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  await knex.raw(`
    CREATE OR REPLACE FUNCTION granules_enforce_global_uniqueness()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
    $$;
  `);

  await knex.raw(`
    CREATE TRIGGER granules_enforce_unique_granule_id
    BEFORE INSERT OR UPDATE OF granule_id OR DELETE
    ON granules
    FOR EACH ROW
    EXECUTE FUNCTION granules_enforce_global_uniqueness();
  `);
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.raw(`
    DROP TRIGGER IF EXISTS granules_enforce_unique_granule_id ON granules;
    DROP FUNCTION IF EXISTS granules_enforce_global_uniqueness;
  `);
};
