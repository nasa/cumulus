import { Knex } from 'knex';

const FUNCTION_NAME = 'files_enforce_global_uniqueness';
const TRIGGER_NAME = 'files_enforce_unique_bucket_key_trigger';

export const up = async (knex: Knex): Promise<void> => {
  await knex.raw(`
    CREATE OR REPLACE FUNCTION ${FUNCTION_NAME}()
    RETURNS trigger AS $$
    DECLARE
      rows smallint;
    BEGIN
      IF (TG_OP IN ('DELETE', 'UPDATE')) THEN
        DELETE FROM files_global_unique
        WHERE bucket = OLD.bucket
        AND key = OLD.key;

      -- Don't block delete if guard row missing
        IF TG_OP = 'DELETE' THEN
          RETURN OLD;
        END IF;
      END IF;

      IF (TG_OP IN ('INSERT', 'UPDATE')) THEN
        INSERT INTO files_global_unique (bucket, key)
        VALUES (NEW.bucket, NEW.key);
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
    BEFORE INSERT OR UPDATE OF bucket, key OR DELETE
    ON files
    FOR EACH ROW
    EXECUTE FUNCTION ${FUNCTION_NAME}();
  `);
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.raw(`
    DROP TRIGGER IF EXISTS ${TRIGGER_NAME} ON files;
    DROP FUNCTION IF EXISTS ${FUNCTION_NAME}();
  `);
};
