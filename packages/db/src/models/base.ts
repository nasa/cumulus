import Knex from 'knex';

import { RecordDoesNotExist } from '@cumulus/errors';

import { tableNames } from '../tables';

import { isRecordDefined } from '../database';

class BasePgModel<ItemType, RecordType extends { cumulus_id: number }> {
  readonly tableName: tableNames;

  constructor({
    tableName,
  }: {
    tableName: tableNames,
  }) {
    this.tableName = tableName;
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

  /**
   * Checks if an item is present in Postgres
   *
   * @param {Knex | Knex.Transaction} knexOrTransaction -
   *  DB client or transaction
   * @param {Partial<RecordType>} whereClause -
   *  An object or any portion of an object of type RecordType
   * @returns {Promise<number>} The cumulus_id of the returned record
   */
  async getRecordCumulusId(
    knexOrTransaction: Knex | Knex.Transaction,
    whereClause : Partial<RecordType>
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
   * @returns {Promise<number>} The ID of the inserted record
   */
  create(
    knexOrTransaction: Knex | Knex.Transaction,
    item: ItemType
  ): Promise<number> {
    return knexOrTransaction(this.tableName)
      .insert(item)
      .returning('cumulus_id');
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
    return knexOrTransaction(this.tableName)
      .where(params)
      .del();
  }
}

export { BasePgModel };
