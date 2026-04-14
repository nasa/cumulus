import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('async_operations', (table) => {
    // Primary key (sequence-backed)
    table.increments('cumulus_id').primary();

    // Columns
    table.uuid('id').notNullable().unique();
    table.text('description').notNullable();
    table.text('operation_type').notNullable();
    table.jsonb('output');
    table.text('status').notNullable();
    table.text('task_arn');

    table.timestamps(false, true);

    // Indexes (can also be split out if you prefer)
    table.index(
      ['status', 'operation_type', 'cumulus_id'],
      'async_operations_status_operation_type_cumulus_id_index'
    );

    table.index(
      ['updated_at'],
      'async_operations_updated_at_index'
    );
  });

  // CHECK constraints (must use raw)
  await knex.raw(`
    ALTER TABLE async_operations
    ADD CONSTRAINT async_operations_operation_type_check
    CHECK (operation_type = ANY (ARRAY[
      'Bulk Execution Archive',
      'Bulk Execution Delete',
      'Bulk Granules',
      'Bulk Granule Archive',
      'Bulk Granule Delete',
      'Bulk Granule Reingest',
      'Data Migration',
      'Dead-Letter Processing',
      'DLA Migration',
      'ES Index',
      'Kinesis Replay',
      'Migration Count Report',
      'Reconciliation Report',
      'SQS Replay'
    ]))
  `);

  await knex.raw(`
    ALTER TABLE async_operations
    ADD CONSTRAINT async_operations_status_check
    CHECK (status = ANY (ARRAY[
      'RUNNING',
      'SUCCEEDED',
      'RUNNER_FAILED',
      'TASK_FAILED'
    ]))
  `);

  // Comments
  await knex.raw(`
    COMMENT ON COLUMN async_operations.id IS 'Unique ID for async operation';
    COMMENT ON COLUMN async_operations.description IS 'description for async operation';
    COMMENT ON COLUMN async_operations.operation_type IS 'type of async operation';
    COMMENT ON COLUMN async_operations.output IS 'output of completed async operation';
    COMMENT ON COLUMN async_operations.status IS 'async operation status';
    COMMENT ON COLUMN async_operations.task_arn IS 'async operation ECS task ARN';
  `);
}

export const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('async_operations');
};
