import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> =>
  await knex.schema.createTable('files', (table) => {
    table
      .bigIncrements('cumulus_id')
      .comment('Internal Cumulus ID for a file')
      .primary();
    table
      .integer('granule_cumulus_id')
      .notNullable();
    table.foreign('granule_cumulus_id')
      .references('cumulus_id')
      .inTable('granules')
      // Automatically delete records in this table whenever the
      // referenced record in the granules table is deleted
      .onDelete('CASCADE');
    table
      .timestamps(false, true);
    table
      .bigInteger('file_size')
      .comment('Size of file (bytes)');
    table
      .text('bucket')
      .comment('AWS Bucket file is archived in')
      .notNullable();
    table
      .text('checksum_type')
      .comment('Type of file checksum (e.g. md5');
    table
      .text('checksum_value')
      .comment('File checksum');
    table
      .text('file_name')
      .comment('Source file name');
    table
      .text('key')
      .comment('AWS S3 key file is archived at')
      .notNullable();
    table
      .text('path')
      .comment('Source file path');
    table
      .text('source')
      .comment('Full source path s3/ftp/sftp/http URI to granule');
    table
      .unique(['bucket', 'key']);
  });

export const down = async (knex: Knex): Promise<void> => await knex.schema
  .dropTableIfExists('files');
