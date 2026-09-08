import { Knex } from 'knex';

const FUNCTION_NAME_PREFIX = 'executions_enforce_global_uniqueness';
const TRIGGER_NAME_PREFIX = 'executions_enforce_unique_arn_url_trigger';

export const up = async (knex: Knex): Promise<void> => {
  // DELETE FUNCTION & TRIGGER
  await knex.raw(`
    CREATE OR REPLACE FUNCTION ${FUNCTION_NAME_PREFIX}_delete() RETURNS trigger AS $$
    BEGIN
      DELETE FROM executions_global_unique WHERE arn = OLD.arn;
      RETURN OLD;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await knex.raw(`
    CREATE TRIGGER ${TRIGGER_NAME_PREFIX}_delete
    BEFORE DELETE ON executions
    FOR EACH ROW
    EXECUTE FUNCTION ${FUNCTION_NAME_PREFIX}_delete();
  `);

  // INSERT FUNCTION & TRIGGER
  await knex.raw(`
    CREATE OR REPLACE FUNCTION ${FUNCTION_NAME_PREFIX}_insert() RETURNS trigger AS $$
    BEGIN
      INSERT INTO executions_global_unique (arn, url)
      VALUES (NEW.arn, NEW.url);

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await knex.raw(`
    CREATE TRIGGER ${TRIGGER_NAME_PREFIX}_insert
    BEFORE INSERT ON executions
    FOR EACH ROW
    EXECUTE FUNCTION ${FUNCTION_NAME_PREFIX}_insert();
  `);

  // UPDATE FUNCTION & TRIGGER
  await knex.raw(`
    CREATE OR REPLACE FUNCTION ${FUNCTION_NAME_PREFIX}_update() RETURNS trigger AS $$
    BEGIN
      DELETE FROM executions_global_unique WHERE arn = OLD.arn;

      INSERT INTO executions_global_unique (arn, url)
      VALUES (NEW.arn, NEW.url);

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await knex.raw(`
    CREATE TRIGGER ${TRIGGER_NAME_PREFIX}_update
    BEFORE UPDATE OF arn, url ON executions
    FOR EACH ROW
    EXECUTE FUNCTION ${FUNCTION_NAME_PREFIX}_update();
  `);
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.raw(`DROP TRIGGER IF EXISTS ${TRIGGER_NAME_PREFIX}_delete ON executions;`);
  await knex.raw(`DROP TRIGGER IF EXISTS ${TRIGGER_NAME_PREFIX}_insert ON executions;`);
  await knex.raw(`DROP TRIGGER IF EXISTS ${TRIGGER_NAME_PREFIX}_update ON executions;`);

  await knex.raw(`DROP FUNCTION IF EXISTS ${FUNCTION_NAME_PREFIX}_delete();`);
  await knex.raw(`DROP FUNCTION IF EXISTS ${FUNCTION_NAME_PREFIX}_insert();`);
  await knex.raw(`DROP FUNCTION IF EXISTS ${FUNCTION_NAME_PREFIX}_update();`);
};
