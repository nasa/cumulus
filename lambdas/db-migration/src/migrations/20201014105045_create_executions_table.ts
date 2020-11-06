import * as Knex from 'knex';

export const up = async (knex: Knex): Promise<void> =>
  knex.schema.createTable('executions', (table) => {
    table
      .increments('cumulusId')
      .primary();
    table
      .text('arn')
      .comment('Execution ARN')
      .notNullable();
    table
      .integer('asyncOperationCumulusId')
      .references('cumulusId')
      .inTable('asyncOperations');
    table
      .integer('collectionCumulusId')
      .references('cumulusId')
      .inTable('collections');
    table
      .integer('parentCumulusId')
      .references('cumulusId')
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
      .text('workflowName')
      .comment('Name of the Cumulus workflow run in this execution');
    table
      .float('duration')
      .comment('Execution duration');
    table
      .jsonb('originalPayload')
      .comment('Original payload of this workflow');
    table
      .jsonb('finalPayload')
      .comment('Final payload of this workflow');
    table
      .timestamp('timestamp')
      .comment('Execution timestamp');
    table
      .timestamps(false, true);
    table.unique(['arn']);
  });

export const down = async (knex: Knex): Promise<void> => knex.schema
  .dropTableIfExists('executions');
