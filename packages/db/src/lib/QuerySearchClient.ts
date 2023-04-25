import { Knex } from 'knex';
import pRetry from 'p-retry';
import Logger from '@cumulus/logger';

import { BaseRecord } from '../types/base';

const log = new Logger({ sender: '@db/QuerySearchClient' });
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
    this.records = await (
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
    return await pRetry(
      async () => {
        try {
          if (this.records.length === 0) await this.fetchRecords();
          return this.records[0];
        } catch (error) {
          if (error.message.includes('Connection terminated unexpectedly')) {
            log.error(`Error caught in QuerySearchClient.peek(). ${error}. Retrying...`);
            throw error;
          }
          log.error(`Error caught in QuerySearchClient.peek(). ${error}`);
          throw new pRetry.AbortError(error);
        }
      },
      {
        retries: 3,
        onFailedAttempt: (e) => {
          log.error(`Error ${e.message}. Attempt ${e.attemptNumber} failed.`);
        },
      }
    );
  }

  /**
   * Remove and return the next item in the results
   *
   * @returns {Promise<RecordType>} - record from PostgreSQL table
   */
  async shift() {
    return await pRetry(
      async () => {
        try {
          if (this.records.length === 0) await this.fetchRecords();
          return this.records.shift();
        } catch (error) {
          if (error.message.includes('Connection terminated unexpectedly')) {
            log.error(`Error caught in QuerySearchClient.shift(). ${error}. Retrying...`);
            throw error;
          }
          log.error(`Error caught in QuerySearchClient.shift(). ${error}`);
          throw new pRetry.AbortError(error);
        }
      },
      {
        retries: 3,
        onFailedAttempt: (e) => {
          log.error(`Error ${e.message}. Attempt ${e.attemptNumber} failed.`);
        },
      }
    );
  }
}

export { QuerySearchClient };
