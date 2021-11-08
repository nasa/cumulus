import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> =>
  await knex.schema.createTable('executions', (table) => {
    table
      .increments('cumulus_id')
      .primary();
    table
      .text('arn')
      .comment('Execution ARN')
      .notNullable();
    table
      .integer('async_operation_cumulus_id')
      .references('cumulus_id')
      .inTable('async_operations');
    table
      .integer('collection_cumulus_id')
      .references('cumulus_id')
      .inTable('collections');
    table
      .integer('parent_cumulus_id')
      .references('cumulus_id')
      .inTable('executions');
    table
      .text('cumulus_version')
      .comment('Cumulus version for the execution');
    table
      .text('url')
      .comment('Execution page url on AWS console');
    table
      .enum('status', ['running', 'completed', 'failed', 'unknown'])
      .comment('Execution status')
      .notNullable();
    table
      .jsonb('tasks')
      .comment('List of completed workflow tasks');
    table
      .jsonb('error')
      .comment('Error details in case of a failed execution');
    table
      .text('workflow_name')
      .comment('Name of the Cumulus workflow run in this execution');
    table
      .float('duration')
      .comment('Execution duration');
    table
      .jsonb('original_payload')
      .comment('Original payload of this workflow');
    table
      .jsonb('final_payload')
      .comment('Final payload of this workflow');
    table
      .timestamp('timestamp')
      .comment('Execution timestamp');
    table
      .timestamps(false, true);
    table.unique(['url']);
    table.unique(['arn']);
  });

export const down = async (knex: Knex): Promise<void> => await knex.schema
  .dropTableIfExists('executions');
