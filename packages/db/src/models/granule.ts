import { Knex } from 'knex';

import { RecordDoesNotExist, InvalidArgument } from '@cumulus/errors';
import { TableNames } from '../tables';
import { PostgresGranule, PostgresGranuleRecord, PostgresGranuleUniqueColumns } from '../types/granule';

import { BasePgModel } from './base';
import { GranulesExecutionsPgModel } from './granules-executions';
import { translateDateToUTC } from '../lib/timestamp';

interface RecordSelect {
  cumulus_id: number
}

function isRecordSelect(param: RecordSelect | PostgresGranuleUniqueColumns): param is RecordSelect {
  return (param as RecordSelect).cumulus_id !== undefined;
}

export default class GranulePgModel extends BasePgModel<PostgresGranule, PostgresGranuleRecord> {
  constructor() {
    super({
      tableName: TableNames.granules,
    });
  }

  /**
   * Deletes the item from Postgres
   *
   * @param {Knex | Knex.Transaction} knexOrTransaction - DB client or transaction
   * @param {Partial<RecordType>} params - An object or any portion of an object of type RecordType
   * @returns {Promise<number>} The number of rows deleted
   */
  async delete(
    knexOrTransaction: Knex | Knex.Transaction,
    params: PostgresGranuleUniqueColumns | { cumulus_id: number }
  ): Promise<number> {
    return await knexOrTransaction(this.tableName)
      .where(params)
      .del();
  }

  /**
   * Checks if a granule is present in PostgreSQL
   *
   * @param {Knex | Knex.Transaction} knexOrTransaction - DB client or transaction
   * @param {PostgresGranuleUniqueColumns | RecordSelect} params - An object
   *          of PostgresGranuleUniqueColumns or RecordSelect
   * @returns {Promise<boolean>} True if the granule exists, false otherwise
   */
  async exists(
    knexOrTransaction: Knex | Knex.Transaction,
    params: PostgresGranuleUniqueColumns | RecordSelect
  ): Promise<boolean> {
    try {
      await this.get(knexOrTransaction, params);
      return true;
    } catch (error) {
      if (error instanceof RecordDoesNotExist) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Fetches a single granule from PostgreSQL
   *
   * @param {Knex | Knex.Transaction} knexOrTransaction - DB client or transaction
   * @param {PostgresGranuleUniqueColumns | RecordSelect} params - An object
   *         of PostgresGranuleUniqueColumns or RecordSelect
   * @returns {Promise<PostgresGranuleRecord>} The returned record
   */
  get(
    knexOrTransaction: Knex | Knex.Transaction,
    params: PostgresGranuleUniqueColumns | RecordSelect
  ): Promise<PostgresGranuleRecord> {
    if (!isRecordSelect(params)) {
      if (!(params.granule_id && params.collection_cumulus_id)) {
        throw new InvalidArgument(`Cannot find granule, must provide either granule_id and collection_cumulus_id or cumulus_id: params(${JSON.stringify(params)})`);
      }
    }
    return super.get(knexOrTransaction, params);
  }

  async upsert(
    knexOrTrx: Knex | Knex.Transaction,
    granule: PostgresGranule,
    executionCumulusId?: number,
    granulesExecutionsPgModel = new GranulesExecutionsPgModel()
  ) {
    if (!granule.created_at) {
      throw new Error(`To upsert granule record must have 'created_at' set: ${JSON.stringify(granule)}`);
    }
    if (granule.status === 'running' || granule.status === 'queued') {
      const upsertQuery = knexOrTrx(this.tableName)
        .insert(granule)
        .onConflict(['granule_id', 'collection_cumulus_id'])
        .merge({
          status: granule.status,
          timestamp: granule.timestamp,
          updated_at: granule.updated_at,
          created_at: granule.created_at,
        })
        .where(knexOrTrx.raw(`${this.tableName}.created_at <= to_timestamp(${translateDateToUTC(granule.created_at)})`));

      // In reality, the only place where executionCumulusId should be
      // undefined is from the data migrations
      if (executionCumulusId) {
        // Only do the upsert if there IS NOT already a record associating
        // the granule to this execution. If there IS already a record
        // linking this granule to this execution, then this upsert query
        // will not affect any rows.
        upsertQuery.whereNotExists(
          granulesExecutionsPgModel.search(
            knexOrTrx,
            { execution_cumulus_id: executionCumulusId }
          )
        );
      }

      upsertQuery.returning('cumulus_id');
      return await upsertQuery;
    }
    return await knexOrTrx(this.tableName)
      .insert(granule)
      .onConflict(['granule_id', 'collection_cumulus_id'])
      .merge()
      .where(knexOrTrx.raw(`${this.tableName}.created_at <= to_timestamp(${translateDateToUTC(granule.created_at)})`))
      .returning('cumulus_id');
  }
}

export { GranulePgModel };
