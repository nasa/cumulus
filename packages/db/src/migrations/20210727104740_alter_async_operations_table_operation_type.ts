import * as Knex from 'knex';
import { formatAlterTableEnumSql } from '../lib/utils';

export const up = async (knex: Knex): Promise<void> => {
  await knex.raw(formatAlterTableEnumSql('async_operations', 'operation_type', [
    'ES Index',
    'Bulk Granules',
    'Bulk Granule Reingest',
    'Bulk Granule Delete',
    'Dead-Letter Processing',
    'Kinesis Replay',
    'Reconciliation Report',
    'Migration Count Report',
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
      'Migration Count Report',
      'Data Migration',
    ])
  );
};
