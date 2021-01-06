import Knex from 'knex';

import { RecordDoesNotExist } from '@cumulus/errors';

import { tableNames } from './tables';

export const isRecordDefined = <T>(record: T) => record !== undefined;

export const doesRecordExist = async<T>(
  params: Partial<T>,
  knex: Knex,
  tableName: string
): Promise<boolean> => isRecordDefined(await knex<T>(tableName).where(params).first());

/**
 * Retrieve cumulus_id for a record from the specified table.
 *
 * @param {Object} whereClause - where clause for query
 * @param {tableNames} table - Name of table
 * @param {Knex|Knex.Transaction} knexOrTrx - Knex client to RDS database
 * @returns {Promise<number>} - Cumulus ID for record
 * @throws {RecordDoesNotExist} if record cannot be found
*/
export const getRecordCumulusId = async<T extends { cumulus_id: number }>(
  whereClause : Partial<T>,
  table: tableNames,
  knexOrTrx: Knex|Knex.Transaction
): Promise<number> => {
  const record: T = await knexOrTrx(table)
    .select('cumulus_id')
    .where(whereClause)
    .first();
  if (!isRecordDefined(record)) {
    throw new RecordDoesNotExist(`Record in ${table} with identifiers ${JSON.stringify(whereClause)} does not exist.`);
  }
  return record.cumulus_id;
};
