import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  // INSERT trigger
  await knex.raw(`
    CREATE OR REPLACE FUNCTION files_global_unique_insert()
    RETURNS trigger AS $$
    BEGIN
      INSERT INTO files_global_unique (bucket, key)
      VALUES (NEW.bucket, NEW.key);

      RETURN NEW;

    EXCEPTION
      WHEN unique_violation THEN
        RAISE unique_violation USING MESSAGE = 'Duplicate file: bucket=' || NEW.bucket || ', key=' || NEW.key;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await knex.raw(`
    CREATE TRIGGER files_global_unique_insert_trigger
    BEFORE INSERT ON files
    FOR EACH ROW
    EXECUTE FUNCTION files_global_unique_insert();
  `);

  // UPDATE trigger (validate existence only)
  await knex.raw(`
    CREATE OR REPLACE FUNCTION files_global_unique_update()
    RETURNS trigger AS $$
    DECLARE
      exists_file TEXT;
    BEGIN
      SELECT bucket
      INTO exists_file
      FROM files_global_unique
      WHERE bucket = OLD.bucket
        AND key = OLD.key;

      IF NOT FOUND THEN
        RAISE EXCEPTION
          'Invariant violation: file (%, %) not found in files_global_unique',
          OLD.bucket,
          OLD.key;
      END IF;

      IF NEW.bucket IS DISTINCT FROM OLD.bucket
      OR NEW.key IS DISTINCT FROM OLD.key THEN
        RAISE EXCEPTION 'bucket and key are immutable and cannot be updated';
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await knex.raw(`
    CREATE TRIGGER files_global_unique_update_trigger
    AFTER UPDATE ON files
    FOR EACH ROW
    EXECUTE FUNCTION files_global_unique_update();
  `);

  // DELETE trigger
  await knex.raw(`
    CREATE OR REPLACE FUNCTION files_global_unique_delete()
    RETURNS trigger AS $$
    BEGIN
      DELETE FROM files_global_unique
      WHERE bucket = OLD.bucket
        AND key = OLD.key;

      RETURN OLD;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await knex.raw(`
    CREATE TRIGGER files_global_unique_delete_trigger
    AFTER DELETE ON files
    FOR EACH ROW
    EXECUTE FUNCTION files_global_unique_delete();
  `);
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.raw(`
    DROP TRIGGER IF EXISTS files_global_unique_insert_trigger ON files;
    DROP TRIGGER IF EXISTS files_global_unique_update_trigger ON files;
    DROP TRIGGER IF EXISTS files_global_unique_delete_trigger ON files;

    DROP FUNCTION IF EXISTS files_global_unique_insert;
    DROP FUNCTION IF EXISTS files_global_unique_update;
    DROP FUNCTION IF EXISTS files_global_unique_delete;
  `);
};
