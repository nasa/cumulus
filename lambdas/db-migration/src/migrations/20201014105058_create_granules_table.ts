import * as Knex from 'knex';

export const up = async (knex: Knex): Promise<void> =>
  knex.schema.createTable('granules', (table) => {
    table
      .bigIncrements('cumulusId')
      .comment('Internal Cumulus ID for a granule')
      .primary();
    table
      .text('granuleId')
      .comment('Granule ID')
      .notNullable();
    table
      .enum('status', ['running', 'completed', 'failed'])
      .comment('Ingest status of the granule')
      .notNullable();
    table
      .integer('collectionCumulusId')
      .references('cumulusId')
      .inTable('collections')
      .notNullable();
    table
      .timestamps(false, true);
    table
      .boolean('published')
      .comment('Flag that shows if the granule has been published in CMR');
    table
      .float('duration')
      .comment('Ingest duration');
    table
      .float('timeToArchive')
      .comment('Number of seconds granule took to archive');
    table
      .float('timeToProcess')
      .comment('Number seconds granule took to complete "processing"');
    table
      .integer('productVolume');
    table
      .jsonb('error')
      .comment('JSON error object');
    table
      .text('cmrLink')
      .comment('Link to granule in the CMR API');
    table
      .integer('executionCumulusId')
      .references('cumulusId')
      .inTable('executions');
    table
      .integer('pdrCumulusId')
      .references('cumulusId')
      .inTable('pdrs');
    table
      .integer('providerCumulusId')
      .references('cumulusId')
      .inTable('providers');
    table
      .timestamp('beginningDateTime')
      .comment('Date granule started');
    table
      .timestamp('endingDateTime')
      .comment('Date granule completed');
    table
      .timestamp('lastUpdateDateTime')
      .comment('Timestap for last update');
    table
      .timestamp('processingEndDateTime')
      .comment('Date granule finished processing');
    table
      .timestamp('processingStartDateTime')
      .comment('Date granule started processing');
    table
      .timestamp('productionDateTime')
      .comment('Timestamp for granule production date/time');
    table
      .timestamp('timestamp');
    table
      .unique(['granuleId', 'collectionCumulusId']);
  });

export const down = async (knex: Knex): Promise<void> => knex.schema
  .dropTableIfExists('granules');
