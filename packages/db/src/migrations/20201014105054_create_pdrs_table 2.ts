import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> =>
  await knex.schema.createTable('pdrs', (table) => {
    table
      .increments('cumulus_id')
      .comment('Internal Cumulus ID for a PDR')
      .primary();
    table
      .integer('collection_cumulus_id')
      .references('cumulus_id')
      .inTable('collections')
      .notNullable();
    table
      .integer('provider_cumulus_id')
      .references('cumulus_id')
      .inTable('providers')
      .notNullable();
    table
      .integer('execution_cumulus_id')
      .references('cumulus_id')
      .inTable('executions');
    table
      .enum('status', ['running', 'failed', 'completed'])
      .comment('Status (running, failed, completed) of the PDR')
      .notNullable();
    table
      .text('name')
      .comment('PDR name')
      .notNullable();
    table
      .float('progress')
      .comment('PDR completion progress percentage');
    table
      .boolean('pan_sent')
      .comment('Boolean defining if a PAN response has been sent for this PDR');
    table
      .text('pan_message')
      .comment('PAN message text');
    table
      .jsonb('stats')
      .comment('PDR stats json object');
    table
      .text('address');
    table
      .text('original_url');
    table
      .float('duration');
    table
      .timestamp('timestamp')
      .comment('PDR timestamp');
    table
      .timestamps(false, true);
    table.unique(['name']);
  });

export const down = async (knex: Knex): Promise<void> => await knex.schema
  .dropTableIfExists('pdrs');
