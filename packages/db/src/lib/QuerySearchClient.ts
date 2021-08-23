import Knex from 'knex';

import { BaseRecord } from '../types/base';

class QuerySearchClient<RecordType extends BaseRecord> {
  readonly query: Knex.QueryBuilder;
  readonly limit: number;
  offset: number;
  records: RecordType[];

  constructor(
    query: Knex.QueryBuilder,
    limit: number
  ) {
    this.query = query;
    this.limit = limit;
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
    this.records = await (
      this.query
        .offset(this.offset)
        .limit(this.limit)
    );
    this.offset += this.limit;
  }

  async peek() {
    if (this.records.length === 0) await this.fetchRecords();
    return this.records[0];
  }

  async shift() {
    if (this.records.length === 0) await this.fetchRecords();
    return this.records.shift();
  }
}

export { QuerySearchClient };
