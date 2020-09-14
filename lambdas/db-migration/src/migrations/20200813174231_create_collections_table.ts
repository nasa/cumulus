import * as Knex from 'knex';

export const up = async (knex: Knex): Promise<void> =>
  knex.schema.createTable('collections', (table) => {
    table
      .increments('cumulusId').primary();
    table
      .text('name')
      .comment('Collection short_name registered with the CMR')
      .notNullable();
    table
      .text('version')
      .comment('The version registered with the CMR')
      .notNullable();
    table
      .text('sampleFileName')
      .comment('Example filename for this collection')
      .notNullable();
    table.text('granuleIdValidationRegex')
      .notNullable()
      .comment('The regular expression used to validate the granule ID extracted from filenames according to the granuleIdExtraction');
    table.text('granuleIdExtractionRegex')
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
      .enum('duplicateHandling', ['error', 'replace', 'skip', 'version'])
      .comment(
        'Duplicate handling behavior for this collection'
      );
    table
      .boolean('reportToEms')
      .comment('Flag to set if this granule should be reported to EMS');
    table
      .boolean('ignoreFilesConfigForDiscovery')
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
  knex.schema.dropTableIfExists('collections');
