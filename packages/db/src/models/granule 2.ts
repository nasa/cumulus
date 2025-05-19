import { Knex } from 'knex';

import { RecordDoesNotExist, InvalidArgument } from '@cumulus/errors';
import { TableNames } from '../tables';
import { PostgresGranule, PostgresGranuleRecord, PostgresGranuleUniqueColumns } from '../types/granule';

import { BasePgModel } from './base';
import { ExecutionPgModel } from './execution';
import { translateDateToUTC } from '../lib/timestamp';
import { getSortFields } from '../lib/sort';

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

  create(knexOrTransaction: Knex | Knex.Transaction, item: PostgresGranule) {
    return super.create(knexOrTransaction, item, '*');
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
    return await knexOrTransaction(this.tableName).where(params).del();
  }

  async deleteExcluding(): Promise<never> {
    throw new Error('deleteExcluding not implemented on granule class');
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
        throw new InvalidArgument(
          `Cannot find granule, must provide either granule_id and collection_cumulus_id or cumulus_id: params(${JSON.stringify(
            params
          )})`
        );
      }
    }
    return super.get(knexOrTransaction, params);
  }

  _buildExclusionClause(
    executionPgModel: ExecutionPgModel,
    executionCumulusId: number,
    knexOrTrx: Knex | Knex.Transaction,
    status: 'queued' | 'running'
  ) {
    const queryBuilder = executionPgModel.queryBuilderSearch(knexOrTrx, {
      cumulus_id: executionCumulusId,
    });
    if (status === 'running') {
      queryBuilder.whereIn('status', ExecutionPgModel.nonActiveStatuses);
    }
    return queryBuilder;
  }

  async upsert(
    knexOrTrx: Knex | Knex.Transaction,
    granule: PostgresGranule,
    executionCumulusId?: number,
    executionPgModel = new ExecutionPgModel()
  ) {
    if (!granule.created_at) {
      throw new Error(
        `To upsert granule record must have 'created_at' set: ${JSON.stringify(
          granule
        )}`
      );
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
        .where(
          knexOrTrx.raw(
            `${this.tableName}.created_at <= to_timestamp(${translateDateToUTC(
              granule.created_at
            )})`
          )
        );

      // In reality, the only place where executionCumulusId should be
      // undefined is from the data migrations OR a queued granule from reingest
      if (executionCumulusId) {
        const exclusionClause = this._buildExclusionClause(
          executionPgModel,
          executionCumulusId,
          knexOrTrx,
          granule.status
        );
        // Only do the upsert if there is no execution that matches the exclusionClause
        // For running granules, this means the execution does not exist in a state other
        // than 'running'.  For queued granules, this means that the execution does not
        // exist at all
        upsertQuery.whereNotExists(exclusionClause);
      }
      upsertQuery.returning('*');
      return await upsertQuery;
    }
    return await knexOrTrx(this.tableName)
      .insert(granule)
      .onConflict(['granule_id', 'collection_cumulus_id'])
      .merge()
      .where(
        knexOrTrx.raw(
          `${this.tableName}.created_at <= to_timestamp(${translateDateToUTC(
            granule.created_at
          )})`
        )
      )
      .returning('*');
  }

  /**
   * Get granules from the granule cumulus_id
   *
   * @param {Knex | Knex.Transaction} knexOrTrx -
   *  DB client or transaction
   * @param {Array<number>} granuleCumulusIds -
   * single granule cumulus_id or array of granule cumulus_ids
   * @param {Object} [params] - Optional object with addition params for query
   * @param {number} [params.limit] - number of records to be returned
   * @param {number} [params.offset] - record offset
   * @returns {Promise<Array<PostgresGranuleRecord>>} An array of granules
   */
  async searchByCumulusIds(
    knexOrTrx: Knex | Knex.Transaction,
    granuleCumulusIds: Array<number> | number,
    params: { limit: number; offset: number }
  ): Promise<Array<PostgresGranuleRecord>> {
    const { limit, offset, ...sortQueries } = params || {};
    const sortFields = getSortFields(sortQueries);
    const granuleCumulusIdsArray = [granuleCumulusIds].flat();
    const granules = await knexOrTrx(this.tableName)
      .whereIn('cumulus_id', granuleCumulusIdsArray)
      .modify((queryBuilder) => {
        if (limit) queryBuilder.limit(limit);
        if (offset) queryBuilder.offset(offset);
        if (sortFields.length >= 1) {
          sortFields.forEach(
            (sortObject: { [key: string]: { order: string } }) => {
              const sortField = Object.keys(sortObject)[0];
              const { order } = sortObject[sortField];
              queryBuilder.orderBy(sortField, order);
            }
          );
        }
      });
    return granules;
  }
}

export { GranulePgModel };
