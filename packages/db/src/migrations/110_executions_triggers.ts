import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  // INSERT trigger
  await knex.raw(`
    CREATE OR REPLACE FUNCTION executions_global_unique_insert()
    RETURNS trigger AS $$
    BEGIN
      INSERT INTO executions_global_unique (arn, url)
      VALUES (NEW.arn, NEW.url);

      RETURN NEW;
    EXCEPTION
      WHEN unique_violation THEN
        RAISE EXCEPTION 'Duplicate ARN or URL: %, %', NEW.arn, NEW.url;
    END;
    $$ LANGUAGE plpgsql;
    `);

  await knex.raw(`
    CREATE TRIGGER executions_global_unique_insert_trigger
    BEFORE INSERT ON executions
    FOR EACH ROW
    EXECUTE FUNCTION executions_global_unique_insert();
  `);

  // UPDATE trigger
  await knex.raw(`
    CREATE OR REPLACE FUNCTION executions_global_unique_update()
    RETURNS trigger AS $$
    DECLARE
      exists_arn TEXT;
    BEGIN
      -- Ensure ARN exists in guard table
      SELECT arn
      INTO exists_arn
      FROM executions_global_unique
      WHERE arn = OLD.arn;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Invariant violation: ARN % not found in executions_global_unique', OLD.arn;
      END IF;

      IF NEW.arn IS DISTINCT FROM OLD.arn THEN
        RAISE EXCEPTION 'arn is immutable';
      END IF;

      -- Update URL only if changed
      IF NEW.url IS DISTINCT FROM OLD.url THEN
        UPDATE executions_global_unique
        SET url = NEW.url
        WHERE arn = OLD.arn;
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await knex.raw(`
    CREATE TRIGGER executions_global_unique_update_trigger
    AFTER UPDATE ON executions
    FOR EACH ROW
    EXECUTE FUNCTION executions_global_unique_update();
  `);

  // DELETE trigger
  await knex.raw(`
    CREATE OR REPLACE FUNCTION executions_global_unique_delete()
    RETURNS trigger AS $$
    BEGIN
      DELETE FROM executions_global_unique
      WHERE arn = OLD.arn;

      RETURN OLD;
    END;
    $$ LANGUAGE plpgsql;
    `);

  await knex.raw(`
    CREATE TRIGGER executions_global_unique_delete_trigger
    AFTER DELETE ON executions
    FOR EACH ROW
    EXECUTE FUNCTION executions_global_unique_delete();
  `);
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.raw(`
    DROP TRIGGER IF EXISTS executions_global_unique_insert_trigger ON executions;
    DROP TRIGGER IF EXISTS executions_global_unique_update_trigger ON executions;
    DROP TRIGGER IF EXISTS executions_global_unique_delete_trigger ON executions;

    DROP FUNCTION IF EXISTS executions_global_unique_insert;
    DROP FUNCTION IF EXISTS executions_global_unique_update;
    DROP FUNCTION IF EXISTS executions_global_unique_delete;
  `);
};
