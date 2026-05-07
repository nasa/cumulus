import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  await knex.schema.createTable('files_global_unique', (table) => {
    table.text('bucket').notNullable();
    table.text('key').notNullable();

    table.primary(['bucket', 'key']);
  });

  await knex.raw(`
    COMMENT ON TABLE files_global_unique IS 'Global lookup table for files uniqueness across partitions';
    COMMENT ON COLUMN files_global_unique.bucket IS 'AWS S3 bucket';
    COMMENT ON COLUMN files_global_unique.key IS 'AWS S3 object key';
  `);
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('files_global_unique');
};
