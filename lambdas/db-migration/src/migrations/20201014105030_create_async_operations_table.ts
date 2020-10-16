import * as Knex from 'knex';

export const up = async (knex: Knex): Promise<void> =>
  knex.schema.createTable('asyncOperations', (table) => {
    table
      .increments('cumulusId')
      .primary();
    table
      .uuid('id')
      .comment('Unique ID for async operation');
    table
      .text('description')
      .comment('description for async operation');
    table
      .enum('operationType', ['ES Index', 'Bulk Granules', 'Bulk Granule Delete', 'Kinesis Replay', 'Reconciliation Report'])
      .comment('type of async operation');
    table
      .jsonb('output')
      .comment('output of completed async operation');
    table
      .enum('status', ['RUNNING', 'SUCCEEDED', 'RUNNER_FAILED', 'TASK_FAILED'])
      .comment('async operation status');
    table
      .text('taskArn')
      .comment('async operation ECS task ARN');
    table
      .timestamps(false, true);
    table.unique(['id']);
  });

export const down = async (knex: Knex): Promise<void> => knex.schema
  .dropTableIfExists('asyncOperations');
