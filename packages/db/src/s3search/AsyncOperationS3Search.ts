import { knex, Knex } from 'knex';
import { DuckDBConnection } from '@duckdb/node-api';

import Logger from '@cumulus/logger';

import { AsyncOperationSearch } from '../search/AsyncOperationSearch';
import { PostgresAsyncOperationRecord } from '../types/async_operation';
import { QueryEvent } from '../types/search';
import { prepareBindings } from './duckdbHelpers';

const log = new Logger({ sender: '@cumulus/db/AsyncOperationS3Search' });

/**
 * Class to build and execute db search query for asyncOperation
 */
export class AsyncOperationS3Search extends AsyncOperationSearch {
  private dbConnection: DuckDBConnection;
  private knexBuilder: Knex;

  constructor(event: QueryEvent, dbConnection: DuckDBConnection) {
    super(event);
    this.dbConnection = dbConnection;
    // Use 'pg' dialect to generate DuckDB-compatible SQL ($1, $2, etc.)
    this.knexBuilder = knex({ client: 'pg' });
  }

  /**
   * Build and execute search query
   *
   * @returns search result
   */
  async query() {
    const { countQuery, searchQuery } = this.buildSearch(this.knexBuilder);

    const shouldReturnCountOnly = this.dbQueryParameters.countOnly === true;

    try {
      const queryConfigs = shouldReturnCountOnly
        ? [{ key: 'count', query: countQuery }]
        : [
          { key: 'count', query: countQuery },
          { key: 'records', query: searchQuery },
        ];

      const executionPromises = queryConfigs.map(async (config) => {
        if (!config.query) return [];

        const { sql, bindings } = config.query.toSQL().toNative();

        const reader = await this.dbConnection.runAndReadAll(
          sql,
          prepareBindings(bindings)
        );

        return reader.getRowObjectsJson();
      });

      const [countResult, pgRecords = []] = await Promise.all(executionPromises);

      const meta = this._metaTemplate();
      meta.limit = this.dbQueryParameters.limit;
      meta.page = this.dbQueryParameters.page;
      meta.count = Number(countResult[0]?.count ?? 0);

      const apiRecords = await this.translatePostgresRecordsToApiRecords(
        pgRecords as unknown[] as PostgresAsyncOperationRecord[]
      );

      return {
        meta,
        results: apiRecords,
      };
    } catch (error) {
      log.error(`Error caught in search query for ${JSON.stringify(this.queryStringParameters)}`, error);
      return error;
    }
  }
}
