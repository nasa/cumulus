import { Knex } from 'knex';

const OLD_OPERATION_TYPES = [
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
  'SQS Replay',
];

const NEW_OPERATION_TYPES = [
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
  'Export Table',
  'Kinesis Replay',
  'Migration Count Report',
  'Reconciliation Report',
  'SQS Replay',
];

const buildCheckSql = (operationTypes: string[]) => `
  ALTER TABLE async_operations
  ADD CONSTRAINT async_operations_operation_type_check
  CHECK (operation_type = ANY (ARRAY[
    ${operationTypes.map((t) => `'${t}'`).join(',\n    ')}
  ]))
`;

export const up = async (knex: Knex): Promise<void> => {
  await knex.raw(`
    ALTER TABLE async_operations
    DROP CONSTRAINT IF EXISTS async_operations_operation_type_check
  `);
  await knex.raw(buildCheckSql(NEW_OPERATION_TYPES));
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.raw(`
    ALTER TABLE async_operations
    DROP CONSTRAINT IF EXISTS async_operations_operation_type_check
  `);
  await knex.raw(buildCheckSql(OLD_OPERATION_TYPES));
};
