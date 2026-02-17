import { knex, Knex } from 'knex';
import { DuckDBConnection } from '@duckdb/node-api';
import pMap from 'p-map';
import Logger from '@cumulus/logger';

import { PdrRecord, PdrSearch } from '../search/PdrSearch';
import { QueryEvent } from '../types/search';
import { prepareBindings } from './duckdbHelpers';

const log = new Logger({ sender: '@cumulus/db/PdrS3Search' });

/**
 * Class to build and execute db search query for PDRs
 */
export class PdrS3Search extends PdrSearch {
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

      let countResult: any[] = [];
      let pgRecords: any[] = [];

      await pMap(
        queryConfigs,
        async (config) => {
          if (!config.query) return;

          const { sql, bindings } = config.query.clone().toSQL().toNative();
          const reader = await this.dbConnection.runAndReadAll(
            sql,
            prepareBindings(bindings)
          );

          const result = reader.getRowObjectsJson();

          if (config.key === 'count') countResult = result;
          else if (config.key === 'records') pgRecords = result;
        },
        { concurrency: 1 } // ensures sequential execution
      );

      const meta = this._metaTemplate();
      meta.limit = this.dbQueryParameters.limit;
      meta.page = this.dbQueryParameters.page;
      meta.count = Number(countResult[0]?.count ?? 0);

      const apiRecords = await this.translatePostgresRecordsToApiRecords(
        pgRecords as unknown[] as PdrRecord[]
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
