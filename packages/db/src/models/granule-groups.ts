import { Knex } from 'knex';

import { isRecordDefined } from '../database';
import { TableNames } from '../tables';

import { PostgresGranuleGroup } from '../types/granule-group';

export default class GranuleGroupsPgModel {
  readonly tableName: TableNames;

  // can't extend base class because type for this data doesn't contain
  // a cumulus_id property
  constructor() {
    this.tableName = TableNames.granuleGroups;
  }

  /**
   * Creates a new granule_group record in Postgres
   *
   * @param {Knex | Knex.Transaction} knexTransaction - DB client or transaction
   * @param {Partial<PostgresGranuleGroup>} item - postgres granule_group object to create
   * @returns {Promise<PostgresGranuleGroup[]>} Fields from returned records
   */
  async create(
    knexTransaction: Knex | Knex.Transaction,
    item: PostgresGranuleGroup
  ) {
    return await knexTransaction(this.tableName).insert(item).returning('*');
  }

  /**
   * Checks if a granule_group record exists in Postgress
   *
   * @param {Knex | Knex.Transaction} knexTransaction - DB client or transaction
   * @param {Partial<PostgresGranuleGroup>} item - postgres granule_group object to check if exists
   * @returns {Promise<Boolean>} True/False value for if the record exists
   */
  async exists(
    knexTransaction: Knex | Knex.Transaction,
    item: PostgresGranuleGroup
  ) {
    return isRecordDefined(await knexTransaction(this.tableName).where(item).first());
  }

  /**
   * Creates a new granule_group record if it doesnt exist or updates one if it does in Postgres
   *
   * @param {Knex | Knex.Transaction} knexTransaction - DB client or transaction
   * @param {Partial<PostgresGranuleGroup>} item - postgres granule_group object to write or create
   * @returns {Promise<PostgresGranuleGroup[]>} List of returned records
   */
  async upsert(
    knexTransaction: Knex | Knex.Transaction,
    item: PostgresGranuleGroup
  ) {
    try {
      return await knexTransaction(this.tableName)
        .insert(item)
        .onConflict(['granule_cumulus_id'])
        .merge()
        .returning('*');
    } catch (error: any) {
      throw new Error(`Failed to upsert granuleGroups record: ${error.message}`);
    }
  }

  /**
   * Creates multiple granule_groups in Postgres
   *
   * @param {Knex | Knex.Transaction} knexOrTransaction - DB client or transaction
   * @param {PostgresGranuleGroup[]} items - Granule_groups records to insert into the DB
   * @param {string | Array<string>} returningFields - A string or array of strings
   *   of columns to return.
   * @returns {Promise<PostgresGranuleGroup[]>} Returns an array of objects
   *   from the specified column(s) from returningFields.
   */
  async insert(
    knexOrTransaction: Knex | Knex.Transaction,
    items: PostgresGranuleGroup[],
    returningFields: string | string[] = '*'
  ): Promise<PostgresGranuleGroup[]> {
    return await knexOrTransaction(this.tableName)
      .insert(items)
      .returning(returningFields);
  }

  /**
   * Deletes granule_group in Postgres
   *
   * @param {Knex | Knex.Transaction} knexOrTransaction - DB client or transaction
   * @param {PostgresGranuleGroup[]} params - Granule_group records to delete from the DB
   * @returns {Promise<PostgresGranuleGroup[]>} Returns an array of objects corresponding to
   * what was deleteds
   */
  async delete(
    knexTransaction: Knex.Transaction,
    params: Partial<PostgresGranuleGroup>
  ): Promise<number> {
    return await knexTransaction(this.tableName)
      .where(params)
      .del();
  }

  /**
   * Search for granule_group record in Postgres
   *
   * @param {Knex | Knex.Transaction} knexOrTransaction - DB client or transaction
   * @param {Partial<PostgresGranuleGroup>} query - The granule_group to search for
   * @returns {Promise<PostgresGranuleGroup[]>} Returns an array of objects corresponding
   * to the search
   */
  async search(
    knexTransaction: Knex | Knex.Transaction,
    query: Partial<PostgresGranuleGroup>
  ) {
    return await knexTransaction<PostgresGranuleGroup>(this.tableName)
      .where(query);
  }

  /**
   * Count for granule_group records in Postgres
   *
   * @param {Knex | Knex.Transaction} knexOrTransaction - DB client or transaction
   * @param {Partial<PostgresGranuleGroup>} params - The granule_groups to count for
   * @returns {Promise<Number[]>} Returns an array of numbers corresponding to the count
   */
  async count(
    knexOrTransaction: Knex | Knex.Transaction,
    params: ([string, string, string] | [Partial<PostgresGranuleGroup>])[]
  ) {
    const query = await knexOrTransaction(this.tableName)
      .where((builder) => {
        params.forEach((param) => {
          if (param.length === 3) {
            builder.where(...param);
          }
          if (param.length === 1) {
            builder.where(param[0]);
          }
        });
      })
      .count();
    return await query;
  }

  /**
   * Retrieves all granule_groups for the given granules' cumulus_ids
   *
   * @param {Knex | Knex.Transaction} knexOrTrx - DB client or transaction
   * @param {Number[]} granule_cumulus_ids - postgres granule_cumulus_ids of granule_groups
   * @param {string | Array<string>} columns - A string or array of strings
   * of columns to return.
   * @returns {Promise<Partial<PostgresGranuleGroup[]>>} List of returned records
   */
  async searchByGranuleCumulusIds(
    knexOrTrx: Knex | Knex.Transaction,
    granule_cumulus_ids: number[],
    columns: string | string[] = '*'
  ): Promise<PostgresGranuleGroup[]> {
    return await knexOrTrx(this.tableName)
      .select(columns)
      .whereIn('granule_cumulus_id', granule_cumulus_ids);
  }
}

export { GranuleGroupsPgModel };
