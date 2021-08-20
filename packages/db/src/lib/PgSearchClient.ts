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
  async next() {
    try {
      const record = await this.pgModel.getByOffset(
        this.knex,
        this.searchParams,
        this.sortColumns,
        this.offset
      );
      this.offset += 1;
      return record;
    } catch (error) {
      if (error instanceof RecordDoesNotExist) {
        return undefined;
      }
      throw error;
    }
  }
}

export { PgSearchClient };
