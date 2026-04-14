import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('collections', (table) => {
    // Primary key (handles sequence automatically)
    table.increments('cumulus_id').primary();

    // Columns
    table.text('name').notNullable();
    table.text('version').notNullable();
    table.text('sample_file_name').notNullable();

    table.text('granule_id_validation_regex').notNullable();
    table.text('granule_id_extraction_regex').notNullable();

    table.jsonb('files').notNullable();

    table.text('process');
    table.text('url_path');

    table.text('duplicate_handling');

    table.boolean('report_to_ems');
    table.boolean('ignore_files_config_for_discovery');

    table.jsonb('meta');
    table.jsonb('tags');

    table.timestamps(false, true);

    table.text('cmr_provider');

    // Indexes
    table.index(['cmr_provider'], 'collection_cmr_provider_index');
    table.index(['updated_at'], 'collections_updated_at_index');
  });

  // Unique constraint (name + version)
  await knex.raw(`
    ALTER TABLE collections
    ADD CONSTRAINT collections_name_version_unique
    UNIQUE (name, version);
  `);

  // CHECK constraint
  await knex.raw(`
    ALTER TABLE collections
    ADD CONSTRAINT collections_duplicate_handling_check
    CHECK (duplicate_handling = ANY (ARRAY[
      'error',
      'replace',
      'skip',
      'version'
    ]));
  `);

  // Comments
  await knex.raw(`
    COMMENT ON COLUMN collections.name IS 'Collection short_name registered with the CMR';
    COMMENT ON COLUMN collections.version IS 'The version registered with the CMR';
    COMMENT ON COLUMN collections.sample_file_name IS 'Example filename for this collection';
    COMMENT ON COLUMN collections.granule_id_validation_regex IS 'The regular expression used to validate the granule ID extracted from filenames according to the granuleIdExtraction';
    COMMENT ON COLUMN collections.granule_id_extraction_regex IS 'The regular expression used to extract the granule ID from filenames';
    COMMENT ON COLUMN collections.files IS 'List of collection file definitions';
    COMMENT ON COLUMN collections.process IS 'Name of the docker process to be used, e.g. modis, aster';
    COMMENT ON COLUMN collections.url_path IS 'The folder (url) used to save granules on S3 buckets';
    COMMENT ON COLUMN collections.duplicate_handling IS 'Duplicate handling behavior for this collection';
    COMMENT ON COLUMN collections.report_to_ems IS 'Flag to set if this collection should be reported to EMS';
    COMMENT ON COLUMN collections.ignore_files_config_for_discovery IS 'When true, ignore the collection files config list for determining which files to ingest for a granule. When false, ingest only files that match a regex in the collection files config list';
    COMMENT ON COLUMN collections.meta IS 'Collection meta object';
    COMMENT ON COLUMN collections.tags IS 'JSON encoded array of collection tags';
    COMMENT ON COLUMN collections.cmr_provider IS 'CMR Provider for this collection';
  `);
}

export const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('collections');
};
