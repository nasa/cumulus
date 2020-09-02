import * as Knex from 'knex';

export const up = async (knex: Knex): Promise<void> => knex.schema
  .createTable('files', (table) => {
    table.bigIncrements('cumulusId').comment('Internal Cumulus ID for a file').primary();
    table.integer('granuleCumulusId').references('cumulusId').inTable('granules').notNullable();
    table.integer('fileSize').comment('Deprecated - size of file');
    table.integer('size').comment('Size of file (bytes)');
    table.text('bucket').comment('AWS Bucket file is archived in');
    table.text('checksumType').comment('Type of file checksum (e.g. md5');
    table.text('checksumValue').comment('File checksum');
    table.text('filename');
    table.text('fileName').comment('Source file name');
    table.text('key').comment('AWS S3 key file is archived at');
    table.text('name');
    table.text('path').comment('Source file path');
    table.text('source').comment('Full source path s3/ftp/sftp/http URI to granule');
    table.timestamps(false, true);
    table.unique(['bucket', 'key']);
  });

export const down = async (knex: Knex): Promise<void> => knex.schema
  .dropTable('files')
  .dropTable('granules');
