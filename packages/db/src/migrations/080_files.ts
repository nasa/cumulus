import { Knex } from 'knex';

const PARTITION_COUNT = 8;

export const up = async (knex: Knex): Promise<void> => {
  // Parent partitioned table
  await knex.raw(`
    CREATE TABLE files (
      cumulus_id BIGINT,
      granule_cumulus_id BIGINT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,

      file_size BIGINT,
      bucket TEXT NOT NULL,
      checksum_type TEXT,
      checksum_value TEXT,
      file_name TEXT,
      key TEXT NOT NULL,
      path TEXT,
      source TEXT,
      type TEXT,

      CONSTRAINT files_pkey PRIMARY KEY (cumulus_id, granule_cumulus_id),

      CONSTRAINT files_granule_cumulus_id_foreign
      FOREIGN KEY (granule_cumulus_id)
      REFERENCES granules_lookup(cumulus_id)
      ON DELETE CASCADE
    )
    PARTITION BY HASH (granule_cumulus_id);
  `);

  // Partitions
  await Promise.all(
    Array.from({ length: PARTITION_COUNT }).map((_, i) =>
      knex.raw(`
        CREATE TABLE files_p${i}
        PARTITION OF files
        FOR VALUES WITH (MODULUS ${PARTITION_COUNT}, REMAINDER ${i});
      `))
  );

  // Indexes (on parent → propagate to partitions)
  await knex.raw(`
    CREATE INDEX files_granule_cumulus_id_index
      ON files (granule_cumulus_id);

    CREATE INDEX files_updated_at_index
      ON files (updated_at);
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
  await knex.raw('DROP TABLE IF EXISTS files CASCADE;');
};
