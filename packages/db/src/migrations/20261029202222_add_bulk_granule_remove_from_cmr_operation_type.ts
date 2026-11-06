import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  await knex.raw(`
    ALTER TABLE async_operations
    DROP CONSTRAINT IF EXISTS async_operations_operation_type_check
  `);

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
      'Bulk Granule Remove From CMR',
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
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.raw(`
    ALTER TABLE async_operations
    DROP CONSTRAINT IF EXISTS async_operations_operation_type_check
  `);

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
};
