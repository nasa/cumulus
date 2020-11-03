import * as Knex from 'knex';

export const up = async (knex: Knex): Promise<void> =>
  knex.schema.createTable('granules', (table) => {
    table
      .bigIncrements('cumulus_id')
      .comment('Internal Cumulus ID for a granule')
      .primary();
    table
      .integer('collection_cumulus_id')
      .references('cumulus_id')
      .inTable('collections')
      .notNullable();
    table
      .timestamps(false, true);
    table
      .boolean('published')
      .comment('Flag that shows if the granule has been published in CMR');
    table
      .enum('status', ['running', 'completed', 'failed'])
      .comment('Ingest status of the granule')
      .notNullable();
    table
      .float('duration')
      .comment('Ingest duration');
    table
      .float('time_to_archive')
      .comment('Number of seconds granule took to archive');
    table
      .float('time_to_process')
      .comment('Number seconds granule took to complete "processing"');
    table
      .integer('product_volume');
    table
      .jsonb('error')
      .comment('JSON error object');
    table
      .text('cmr_link')
      .comment('Link to granule in the CMR API');
    table
      .text('execution')
      .comment('Step Function Execution link')
      .notNullable();
    table
      .text('granule_id')
      .comment('Granule ID')
      .notNullable();
    table
      .text('pdr_name')
      .comment('PDR associated with the granule');
    table
      .text('provider')
      .comment('Provider granule is associated with');
    table
      .timestamp('beginning_date_time')
      .comment('Date granule started');
    table
      .timestamp('ending_date_time')
      .comment('Date granule completed');
    table
      .timestamp('last_update_date_time')
      .comment('Timestap for last update');
    table
      .timestamp('processing_end_datetime')
      .comment('Date granule finished processing');
    table
      .timestamp('processing_start_datetime')
      .comment('Date granule started processing');
    table
      .timestamp('production_datetime')
      .comment('Timestamp for granule production date/time');
    table
      .timestamp('timestamp');
    table
      .unique(['granule_id', 'collection_cumulus_id']);
  });

export const down = async (knex: Knex): Promise<void> => knex.schema
  .dropTableIfExists('granules');
