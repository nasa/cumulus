import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  await knex.raw(`
    CREATE OR REPLACE FUNCTION executions_enforce_global_uniqueness()
    RETURNS trigger AS $$
    DECLARE
      rows smallint;
    BEGIN
      IF (TG_OP IN ('DELETE', 'UPDATE')) THEN
        DELETE FROM executions_global_unique
        WHERE arn = OLD.arn;

      -- Don't block delete if guard row missing
        IF TG_OP = 'DELETE' THEN
          RETURN OLD;
        END IF;
      END IF;

      IF (TG_OP IN ('INSERT', 'UPDATE')) THEN
        INSERT INTO executions_global_unique (arn, url)
        VALUES (NEW.arn, NEW.url);
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
    CREATE TRIGGER executions_enforce_unique_arn_url_trigger
    BEFORE INSERT OR UPDATE OF arn, url OR DELETE
    ON executions
    FOR EACH ROW
    EXECUTE FUNCTION executions_enforce_global_uniqueness();
  `);
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.raw(`
    DROP TRIGGER IF EXISTS executions_enforce_unique_arn_url_trigger ON executions;
    DROP FUNCTION IF EXISTS executions_enforce_global_uniqueness();
  `);
};
