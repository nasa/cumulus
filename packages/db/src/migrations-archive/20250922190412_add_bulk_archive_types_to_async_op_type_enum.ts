import { Knex } from 'knex';

const formatAlterTableEnumSql = (
  tableName: string,
  columnName: string,
  enums: Array<string>
) => {
  const constraintName = `${tableName}_${columnName}_check`;
  return [
    `ALTER TABLE ${tableName}`,
    `DROP CONSTRAINT IF EXISTS ${constraintName};`,
    `ALTER TABLE ${tableName} ADD CONSTRAINT ${constraintName} CHECK (${columnName} = ANY (ARRAY['${enums.join(
      "'::text, '"
    )}'::text]));`,
  ].join('\n');
};

export const up = async (knex: Knex): Promise<void> => {
  await knex.raw(formatAlterTableEnumSql('async_operations', 'operation_type', [
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
  ]));
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.raw(
    formatAlterTableEnumSql('async_operations', 'operation_type', [
      'Bulk Execution Delete',
      'Bulk Granules',
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
    ])
  );
};
