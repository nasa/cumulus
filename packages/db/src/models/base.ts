import Knex from 'knex';

import { RecordDoesNotExist } from '@cumulus/errors';

import { updatedAtRange } from '../types/record';
import { BaseRecord } from '../types/base';
import { tableNames } from '../tables';
import { isRecordDefined } from '../database';

class BasePgModel<ItemType, RecordType extends BaseRecord> {
  readonly tableName: tableNames;

  constructor({
    tableName,
  }: {
    tableName: tableNames,
  }) {
    this.tableName = tableName;
  }

  /**
   * Fetches multiple items from Postgres
   *
   * @param {Knex | Knex.Transaction} knexOrTransaction - DB client or transaction
   * @param {Partial<RecordType>} params - An object or any portion of an object of type RecordType
   * @param {updatedAtRange} updatedAtParams - An object with Date search bounds for updatedAt
   * @returns {Promise<PostgresCollectionRecord[]>} List of returned records
   */
  async searchWithUpdatedAtRange(
    knexOrTransaction: Knex | Knex.Transaction,
    params: Partial<RecordType>,
    updatedAtParams: updatedAtRange
  ): Promise<RecordType[]> {
    const records: Array<RecordType> = await knexOrTransaction(this.tableName)
      .where((builder) => {
        builder.where(params);
        if (updatedAtParams.updatedAtFrom || updatedAtParams.updatedAtTo) {
          builder.whereBetween('updated_at', [
            updatedAtParams?.updatedAtFrom ?? new Date(0),
            updatedAtParams?.updatedAtTo ?? new Date(),
          ]);
        }
      });
    return records;
  }

  async count(
    knexOrTransaction: Knex | Knex.Transaction,
    params: ([string, string, string] | [Partial<RecordType>])[]
  ) {
    const query = knexOrTransaction(this.tableName).where((builder) => {
      params.forEach((param) => {
        if (param.length === 3) {
          builder.where(...param);
        }
        if (param.length === 1) {
          builder.where(param[0]);
        }
      });
    }).count();
    return await query;
  }

  /**
   * Fetches a single item from Postgres
   *
   * @param {Knex | Knex.Transaction} knexOrTransaction - DB client or transaction
   * @param {Partial<RecordType>} params - An object or any portion of an object of type RecordType
   * @returns {Promise<RecordType>} The returned record
   */
  async get(
    knexOrTransaction: Knex | Knex.Transaction,
    params: Partial<RecordType>
  ): Promise<RecordType> {
    const record: RecordType = await knexOrTransaction(this.tableName)
      .where(params)
      .first();

    if (!isRecordDefined(record)) {
      throw new RecordDoesNotExist(`Record in ${this.tableName} with identifiers ${JSON.stringify(params)} does not exist.`);
    }

    return record;
  }

  async getMaxCumulusId(
    knexOrTransaction: Knex | Knex.Transaction
  ): Promise<number> {
    const result = await knexOrTransaction(this.tableName).max('cumulus_id').first();
    if (!result) {
      throw new Error('Invalid index query on getMaxCumulusId, max index cannot be returned');
    }
    return Number(result.max);
  }

  async paginateByCumulusId(
    knexOrTransaction: Knex | Knex.Transaction,
    startId: number = 0,
    pageSize: number = 100,
    keys: Array<keyof RecordType> = []
  ): Promise<RecordType[]> {
  // @ts-ignore
    return await knexOrTransaction.select(...keys)
      .from(this.tableName)
      .whereBetween('cumulus_id', [startId, startId + pageSize - 1]);
  }

  /**
   * Fetches multiple items from Postgres
   *
   * @param {Knex | Knex.Transaction} knexOrTransaction - DB client or transaction
   * @param {Partial<RecordType>} params - An object or any portion of an object of type RecordType
   * @returns {Promise<RecordType[]>} List of returned records
   */
  async search(
    knexOrTransaction: Knex | Knex.Transaction,
    params: Partial<RecordType>
  ): Promise<RecordType[]> {
    const records: Array<RecordType> = await knexOrTransaction(this.tableName)
      .where(params);

    return records;
  }

  /**
   * Get cumulus_id column value for record in Postgres
   *
   * @param {Knex | Knex.Transaction} knexOrTransaction -
   *  DB client or transaction
   * @param {Partial<RecordType>} whereClause -
   *  An object or any portion of an object of type RecordType
   * @returns {Promise<number>} The cumulus_id of the returned record
   */
  async getRecordCumulusId(
    knexOrTransaction: Knex | Knex.Transaction,
    whereClause: Partial<RecordType>
  ): Promise<number> {
    const record: RecordType = await knexOrTransaction(this.tableName)
      .select('cumulus_id')
      .where(whereClause)
      .first();
    if (!isRecordDefined(record)) {
      throw new RecordDoesNotExist(`Record in ${this.tableName} with identifiers ${JSON.stringify(whereClause)} does not exist.`);
    }
    return record.cumulus_id;
  }

  // eslint-disable-next-line valid-jsdoc
  /**
   * Get cumulus_id column value for multiple records in Postgres
   *
   * @param {Knex | Knex.Transaction} knexOrTransaction -
   *  DB client or transaction
   * @param {Array<keyof RecordType>} columnNames - column names for whereIn query
   * @param {Array<any>} values - record values for whereIn query
   * @returns {Promise<Array<number>>} An array of cumulus_ids for the returned records
   */
  async getRecordsCumulusIds(
    knexOrTransaction: Knex | Knex.Transaction,
    columnNames: Array<keyof RecordType>,
    values: Array<any>
  ): Promise<Array<number>> {
    const records: Array<RecordType> = await knexOrTransaction(this.tableName)
      .select('cumulus_id')
      .whereIn(columnNames, values);
    return records.map((record) => record.cumulus_id);
  }

  /**
   * Checks if an item is present in Postgres
   *
   * @param {Knex | Knex.Transaction} knexOrTransaction - DB client or transaction
   * @param {Partial<RecordType>} params - An object or any portion of an object of type RecordType
   * @returns {Promise<boolean>} True if the item exists, false otherwise
   */
  async exists(
    knexOrTransaction: Knex | Knex.Transaction,
    params: Partial<RecordType>
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
   * Creates an item in Postgres
   *
   * @param {Knex | Knex.Transaction} knexOrTransaction - DB client or transaction
   * @param {ItemType} item - A record to insert into the DB
   * @param {string | Array<string>} returningFields - A string or array of strings
   *   of columns to return. Defaults to 'cumulus_id'.
   * @returns {Promise<unknown[] | Object[]>} Returns an array of objects or an
   *   array of values from the specified column(s) from returningFields.
   */
  async create(
    knexOrTransaction: Knex | Knex.Transaction,
    item: ItemType,
    returningFields: string | string[] = 'cumulus_id'
  ): Promise<unknown[] | Object[]> {
    return await knexOrTransaction(this.tableName)
      .insert(item)
      .returning(returningFields);
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
    params: Partial<RecordType>
  ): Promise<number> {
    return await knexOrTransaction(this.tableName)
      .where(params)
      .del();
  }

  /**
   * Updates the item or items in Postgres
   *
   * @param {Knex | Knex.Transaction} knexOrTransaction - DB client or transaction
   * @param {Partial<RecordType>} whereClause - The identifiers used to match records
   * @param {Partial<RecordType>} updateParams - The fields to update
   * @param {Array<string>} returning - A list of fields to return after update
   * @returns {Promise<RecordType[]>} List of returned records
   */
  async update(
    knexOrTransaction: Knex | Knex.Transaction,
    whereClause: Partial<RecordType>,
    updateParams: Partial<RecordType>,
    returning: Array<string> = []
  ) {
    return await knexOrTransaction(this.tableName)
      .where(whereClause)
      .update(updateParams, returning);
  }
}

export { BasePgModel };
