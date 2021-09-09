import * as Knex from 'knex';
import { formatAlterTableEnumSql } from '../lib/utils';

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
