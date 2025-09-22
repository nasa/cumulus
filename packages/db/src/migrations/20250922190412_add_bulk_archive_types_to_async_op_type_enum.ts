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
    'Bulk Granule Delete',
    'Bulk Granule Reingest',
    'Bulk Granules',
    'Bulk Execution Delete',
    'Data Migration',
    'Dead-Letter Processing',
    'DLA Migration',
    'ES Index',
    'Kinesis Replay',
    'Reconciliation Report',
    'Migration Count Report',
    'SQS Replay',
    'Bulk Granule Archive',
    'Bulk Execution Archive',
  ]));
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.raw(
    formatAlterTableEnumSql('async_operations', 'operation_type', [
      'Bulk Granule Delete',
      'Bulk Granule Reingest',
      'Bulk Granules',
      'Bulk Execution Delete',
      'Data Migration',
      'Dead-Letter Processing',
      'DLA Migration',
      'ES Index',
      'Kinesis Replay',
      'Reconciliation Report',
      'Migration Count Report',
      'SQS Replay',
    ])
  );
};
