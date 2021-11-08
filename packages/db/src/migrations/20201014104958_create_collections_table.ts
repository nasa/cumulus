import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> =>
  await knex.schema.createTable('collections', (table) => {
    table
      .increments('cumulus_id').primary();
    table
      .text('name')
      .comment('Collection short_name registered with the CMR')
      .notNullable();
    table
      .text('version')
      .comment('The version registered with the CMR')
      .notNullable();
    table
      .text('sample_file_name')
      .comment('Example filename for this collection')
      .notNullable();
    table
      .text('granule_id_validation_regex')
      .notNullable()
      .comment('The regular expression used to validate the granule ID extracted from filenames according to the granuleIdExtraction');
    table
      .text('granule_id_extraction_regex')
      .comment('The regular expression used to extract the granule ID from filenames')
      .notNullable();
    table
      .jsonb('files')
      .comment('List of collection file definitions')
      .notNullable();
    table
      .text('process')
      .comment('Name of the docker process to be used, e.g. modis, aster');
    table
      .text('url_path')
      .comment('The folder (url) used to save granules on S3 buckets');
    table
      .enum('duplicate_handling', ['error', 'replace', 'skip', 'version'])
      .comment(
        'Duplicate handling behavior for this collection'
      );
    table
      .boolean('report_to_ems')
      .comment('Flag to set if this collection should be reported to EMS');
    table
      .boolean('ignore_files_config_for_discovery')
      .comment('When true, ignore the collection files config list for determining which files to ingest for a granule. When false, ingest only files that match a regex in the colletion files config list');
    table
      .jsonb('meta')
      .comment('Collection meta object');
    table
      .jsonb('tags')
      .comment('JSON encoded array of collection tags');
    // adds "created_at" and "updated_at" columns automatically
    table
      .timestamps(false, true);
    // add unique constraints
    table
      .unique(['name', 'version']);
  });

export const down = async (knex: Knex): Promise<void> =>
  await knex.schema.dropTableIfExists('collections');
