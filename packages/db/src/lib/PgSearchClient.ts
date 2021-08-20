import Knex from 'knex';

import { RecordDoesNotExist } from '@cumulus/errors';

import { BasePgModel } from '../models/base';
import { BaseRecord } from '../types/base';

class PgSearchClient<ItemType, RecordType extends BaseRecord> {
  readonly knex: Knex;
  readonly pgModel: BasePgModel<ItemType, RecordType>;
  readonly searchParams: Partial<RecordType>;
  readonly sortColumns: (keyof RecordType)[];
  offset: number;
  lastFetchedOffset?: number;
  record?: RecordType;

  constructor({
    knex,
    pgModel,
    searchParams,
    sortColumns,
  }: {
    knex: Knex,
    pgModel: BasePgModel<ItemType, RecordType>,
    searchParams: Partial<RecordType>,
    sortColumns: (keyof RecordType)[],
  }) {
    this.knex = knex;
    this.pgModel = pgModel;
    this.searchParams = searchParams;
    this.sortColumns = sortColumns;
    this.offset = 0;
  }

  /**
   * Return next item from a set of results (if any) and increment offset of search
   * client so that successive call to this method will return the next result (if any).
   *
   * @returns {Promise<RecordType>}
   * @throws
   */
  private async fetchRecord() {
    try {
      this.record = await this.pgModel.getByOffset(
        this.knex,
        this.searchParams,
        this.sortColumns,
        this.offset
      );
    } catch (error) {
      if (error instanceof RecordDoesNotExist) {
        this.record = undefined;
      } else {
        throw error;
      }
    }
    this.lastFetchedOffset = this.offset;
  }

  async hasNextRecord() {
    if (!this.lastFetchedOffset || this.offset !== this.lastFetchedOffset) await this.fetchRecord();
    return this.record !== undefined;
  }

  async getNextRecord() {
    if (!this.lastFetchedOffset || this.offset !== this.lastFetchedOffset) await this.fetchRecord();
    this.offset += 1;
    return this.record;
  }
}

export { PgSearchClient };
