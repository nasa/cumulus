import Knex from 'knex';

import { BaseRecord } from '../types/base';

// type QueryFnParams<T> = {
//   knex: Knex,
//   searchParams: Partial<T>,
//   sortColumns: (keyof T)[]
//   limit?: number
// };
// type QueryFn<T> = (params: QueryFnParams<T>) => Promise<T[]>;

class QuerySearchClient<RecordType extends BaseRecord> {
  // readonly queryFn: QueryFn<RecordType>;
  readonly query: Knex.QueryBuilder;
  readonly knex: Knex;
  readonly searchParams: Partial<RecordType>;
  readonly sortColumns: (keyof RecordType)[];
  offset: number;
  records: RecordType[];

  constructor(
    // queryFn: QueryFn<RecordType>,
    query: Knex.QueryBuilder,
    {
      knex,
      searchParams,
      sortColumns,
    }: {
      knex: Knex,
      searchParams: Partial<RecordType>,
      sortColumns: (keyof RecordType)[],
    }
  ) {
    this.knex = knex;
    // this.queryFn = queryFn;
    this.query = query;
    this.searchParams = searchParams;
    this.sortColumns = sortColumns;
    this.offset = 0;
    this.records = [];
  }

  /**
   * Return next items from a set of results (if any).
   *
   * @returns {Promise<RecordType[]>}
   * @throws
   */
  private async fetchRecords() {
    this.records = await this.query;
  }

  async hasNextRecord() {
    if (this.records.length === 0) await this.fetchRecords();
    return this.records[0];
  }

  async getNextRecord() {
    if (this.records.length === 0) await this.fetchRecords();
    return this.records.shift();
  }
}

export { QuerySearchClient };
