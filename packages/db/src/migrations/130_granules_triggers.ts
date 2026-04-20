import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  // INSERT trigger
  await knex.raw(`
    CREATE OR REPLACE FUNCTION granules_global_unique_insert()
    RETURNS trigger AS $$
    BEGIN
      INSERT INTO granules_global_unique (granule_id)
      VALUES (NEW.granule_id);

      RETURN NEW;
    EXCEPTION
      WHEN unique_violation THEN
        RAISE EXCEPTION 'Duplicate granule_id: %', NEW.granule_id;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await knex.raw(`
    CREATE TRIGGER granules_global_unique_insert_trigger
    BEFORE INSERT ON granules
    FOR EACH ROW
    EXECUTE FUNCTION granules_global_unique_insert();
  `);

  // UPDATE trigger
  await knex.raw(`
    CREATE OR REPLACE FUNCTION granules_global_unique_update()
    RETURNS trigger AS $$
    DECLARE
      exists_granule_id TEXT;
    BEGIN
      -- Check existence in guard table
      SELECT granule_id
      INTO exists_granule_id
      FROM granules_global_unique
      WHERE granule_id = OLD.granule_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION
          'Invariant violation: granule_id % not found in granules_global_unique', OLD.granule_id;
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await knex.raw(`
    CREATE TRIGGER granules_global_unique_update_trigger
    AFTER UPDATE ON granules
    FOR EACH ROW
    WHEN (OLD.granule_id IS DISTINCT FROM NEW.granule_id)
    EXECUTE FUNCTION granules_global_unique_update();
  `);

  // DELETE trigger
  await knex.raw(`
    CREATE OR REPLACE FUNCTION granules_global_unique_delete()
    RETURNS trigger AS $$
    BEGIN
      DELETE FROM granules_global_unique
      WHERE granule_id = OLD.granule_id;

      RETURN OLD;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await knex.raw(`
    CREATE TRIGGER granules_global_unique_delete_trigger
    AFTER DELETE ON granules
    FOR EACH ROW
    EXECUTE FUNCTION granules_global_unique_delete();
  `);
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.raw(`
    DROP TRIGGER IF EXISTS granules_global_unique_insert_trigger ON granules;
    DROP TRIGGER IF EXISTS granules_global_unique_update_trigger ON granules;
    DROP TRIGGER IF EXISTS granules_global_unique_delete_trigger ON granules;

    DROP FUNCTION IF EXISTS granules_global_unique_insert;
    DROP FUNCTION IF EXISTS granules_global_unique_update;
    DROP FUNCTION IF EXISTS granules_global_unique_delete;
  `);
};
