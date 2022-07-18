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
    'ES Index',
    'Bulk Granules',
    'Bulk Granule Reingest',
    'Bulk Granule Delete',
    'Dead-Letter Processing',
    'Kinesis Replay',
    'Reconciliation Report',
    'Data Migration',
    'SQS Replay',
  ]));
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.raw(
    formatAlterTableEnumSql('async_operations', 'operation_type', [
      'ES Index',
      'Bulk Granules',
      'Bulk Granule Reingest',
      'Bulk Granule Delete',
      'Dead-Letter Processing',
      'Kinesis Replay',
      'Reconciliation Report',
      'Data Migration',
    ])
  );
};
