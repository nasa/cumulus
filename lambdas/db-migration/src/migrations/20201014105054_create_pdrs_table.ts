import * as Knex from 'knex';

export const up = async (knex: Knex): Promise<void> =>
  knex.schema.createTable('pdrs', (table) => {
    table
      .increments('cumulusId')
      .comment('Internal Cumulus ID for a PDR')
      .primary();
    table
      .integer('collectionCumulusId')
      .references('cumulusId')
      .inTable('collections')
      .notNullable();
    table
      .integer('providerCumulusId')
      .references('cumulusId')
      .inTable('providers')
      .notNullable();
    table
      .integer('executionCumulusId')
      .references('cumulusId')
      .inTable('executions');
    table
      .enum('status', ['running', 'failed', 'completed'])
      .comment('Status (running, failed, completed) of the PDR')
      .notNullable();
    table
      .float('progress')
      .comment('PDR completion progress percentage');
    table
      .boolean('PANSent')
      .comment('Boolean defining if a PAN response has been sent for this PDR');
    table
      .text('PANmessage')
      .comment('PAN message text');
    table
      .jsonb('stats')
      .comment('PDR stats json object');
    table
      .text('address');
    table
      .text('originalUrl');
    table
      .integer('duration');
    table
      .text('name')
      .comment('PDR name')
      .notNullable();
    table
      .timestamp('timestamp')
      .comment('PDR timestamp');
    table
      .timestamps(false, true);
    table.unique(['name']);
  });

export const down = async (knex: Knex): Promise<void> => knex.schema
  .dropTableIfExists('pdrs');
