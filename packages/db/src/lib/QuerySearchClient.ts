import { Knex } from 'knex';

import { RetryOnDbConnectionTerminateError } from './retry';
import { BaseRecord } from '../types/base';

/**
 * Class to handle fetching results for an arbitrary PostgreSQL query and
 * paging through them.
 */
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
   * Query the PostgreSQL database for the given offset/limit to get a set of results.
   *
   * @returns {Promise<RecordType[]>} - set of records from PostgreSQL table
   * @throws
   */
  private async fetchRecords() {
    this.records = await RetryOnDbConnectionTerminateError(
      this.query
        .offset(this.offset)
        .limit(this.limit)
    );
    this.offset += this.limit;
  }

  /**
   * View the next item in the results
   *
   * This does not remove the object from the queue.
   *
   * @returns {Promise<RecordType>} - record from PostgreSQL table
   */
  async peek() {
    if (this.records.length === 0) await this.fetchRecords();
    return this.records[0];
  }

  /**
   * Remove and return the next item in the results
   *
   * @returns {Promise<RecordType>} - record from PostgreSQL table
   */
  async shift() {
    if (this.records.length === 0) await this.fetchRecords();
    return this.records.shift();
  }
}

export { QuerySearchClient };
