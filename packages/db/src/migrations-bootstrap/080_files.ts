import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  await knex.schema.createTable('files', (table) => {
    // Primary key
    table.bigIncrements('cumulus_id').primary();

    // Foreign key
    table.bigInteger('granule_cumulus_id').notNullable();

    // Columns
    table.bigInteger('file_size');

    table.text('bucket').notNullable();

    table.text('checksum_type');
    table.text('checksum_value');

    table.text('file_name');

    table.text('key').notNullable();
    table.text('path');
    table.text('source');
    table.text('type');

    table.timestamps(false, true);

    // Indexes
    table.index(['granule_cumulus_id'], 'files_granule_cumulus_id_index');
    table.index(['updated_at'], 'files_updated_at_index');
  });

  // Unique constraint
  await knex.raw(`
    ALTER TABLE files
    ADD CONSTRAINT files_bucket_key_unique UNIQUE (bucket, key);
  `);

  // Foreign key
  await knex.raw(`
    ALTER TABLE files
    ADD CONSTRAINT files_granule_cumulus_id_foreign
    FOREIGN KEY (granule_cumulus_id)
    REFERENCES granules(cumulus_id)
    ON DELETE CASCADE;
  `);

  // Comments
  await knex.raw(`
    COMMENT ON COLUMN files.cumulus_id IS 'Internal Cumulus ID for a file';
    COMMENT ON COLUMN files.file_size IS 'Size of file (bytes)';
    COMMENT ON COLUMN files.bucket IS 'AWS Bucket file is archived in';
    COMMENT ON COLUMN files.checksum_type IS 'Type of file checksum (e.g. md5';
    COMMENT ON COLUMN files.checksum_value IS 'File checksum';
    COMMENT ON COLUMN files.file_name IS 'Source file name';
    COMMENT ON COLUMN files.key IS 'AWS S3 key file is archived at';
    COMMENT ON COLUMN files.path IS 'Source file path';
    COMMENT ON COLUMN files.source IS 'Full source path s3/ftp/sftp/http URI to granule';
    COMMENT ON COLUMN files.type IS 'file "type"';
  `);
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('files');
};
