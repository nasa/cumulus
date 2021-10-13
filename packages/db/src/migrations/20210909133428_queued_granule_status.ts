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
  await knex.raw(formatAlterTableEnumSql('granules', 'status', [
    'running',
    'completed',
    'failed',
    'queued',
  ]));
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.raw(formatAlterTableEnumSql('granules', 'status', [
    'running',
    'completed',
    'failed',
  ]));
};
