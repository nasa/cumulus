import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  await knex.schema.createTable('files_lookup', (table) => {
    // Primary key (global)
    table.bigInteger('cumulus_id').primary();

    // Business identifiers
    table.text('bucket').notNullable();
    table.text('key').notNullable();

    // Enforce global uniqueness
    table.unique(['bucket', 'key']);
  });

  await knex.raw(`
    COMMENT ON TABLE files_lookup IS 'Global lookup table for files primary and unique keys';
    COMMENT ON COLUMN files_lookup.cumulus_id IS 'Global primary key for files';
    COMMENT ON COLUMN files_lookup.bucket IS 'AWS S3 bucket';
    COMMENT ON COLUMN files_lookup.key IS 'AWS S3 object key';
  `);
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('files_lookup');
};
