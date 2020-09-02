import * as Knex from 'knex';

export const up = async (knex: Knex): Promise<void> => knex.schema
  .createTable('granules', (table) => {
    table.bigIncrements('cumulusId').comment('Internal Cumulus ID for a granule').primary();
    table.integer('collectionCumulusId').references('cumulusId').inTable('collections').notNullable();
    table.date('beginningDateTime').comment('Date granule started');
    table.date('endingDateTime').comment('Date granule completed');
    table.date('lastUpdateDateTime').comment('Timestap for last update');
    table.date('processingEndDateTime').comment('Date granule finished processing');
    table.date('procvessingStartDateTime').comment('Date granule started processing');
    table.date('productionDateTime').comment('Timestamp for granule production date/time');
    table.date('timestamp');
    table.enum('status', ['running', 'completed', 'failed']).comment('Ingest status of the granule');
    table.float('duration').comment('Ingest duration');
    table.float('timeToArchive').comment('Number of seconds granule took to archive');
    table.float('timeToProcess').comment('Number seconds granule took to complete "processing"');
    table.integer('productVolume');
    table.jsonb('error').comment('JSON error object');
    table.text('boolean').comment('Flag that shows if the granule has been published in CMR');
    table.text('cmrLink').comment('Link to granule in the CMR API');
    table.text('execution').comment('Step Function Execution link');
    table.text('granuleId').comment('Granule ID');
    table.text('pdrName').comment('PDR associated with the granule');
    table.text('provider').comment('Provider granule is associated with');
    table.timestamps(false, true);
    table.unique(['granuleId', 'collectionCumulusId']);
  }).createTable('files', (table) => {
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
