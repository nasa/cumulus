import { knex, Knex } from 'knex';
import { DuckDBConnection } from '@duckdb/node-api';

import { QueryEvent } from '../types/search';
import {
  ApiAggregateResult, StatsSearch, SummaryResult, TotalSummary,
} from '../search/StatsSearch';
import { acquireDuckDbConnection, releaseDuckDbConnection } from '../iceberg-connection';
import { prepareBindings } from './duckdbHelpers';

/**
 * A class to query postgres for the STATS and STATS/AGGREGATE endpoints
 */
class StatsS3Search extends StatsSearch {
  private dbConnection: DuckDBConnection | undefined;
  private knexBuilder: Knex;

  constructor(event: QueryEvent, type: string, dbConnection?: DuckDBConnection) {
    super(event, type);
    this.dbConnection = dbConnection;
    // Use 'pg' dialect to generate DuckDB-compatible SQL ($1, $2, etc.)
    this.knexBuilder = knex({ client: 'pg' });
  }

  /**
   * Queries postgres for a summary of statistics around the granules in the system
   *
   * @returns the postgres aggregations based on query
   */
  public async summary(): Promise<SummaryResult> {
    const aggregateQuery = this.buildSummaryQuery(this.knexBuilder);

    const { sql, bindings } = aggregateQuery.toSQL().toNative();
    const injected = this.dbConnection;
    const dbConnection = injected ?? await acquireDuckDbConnection();
    try {
      const reader = await dbConnection.runAndReadAll(
        sql,
        prepareBindings([...bindings])
      );
      const aggregateQueryRes: TotalSummary[] = reader.getRowObjectsJson() as any[];
      return this.formatSummaryResult(aggregateQueryRes[0]);
    } finally {
      if (!injected) {
        await releaseDuckDbConnection(dbConnection);
      }
    }
  }

  /**
   * Executes the aggregate search query
   *
   * @returns the aggregate query results in api format
   */
  async aggregate(): Promise<ApiAggregateResult> {
    const { searchQuery } = this.buildSearch(this.knexBuilder);
    const { sql, bindings } = searchQuery.toSQL().toNative();
    const injected = this.dbConnection;
    const dbConnection = injected ?? await acquireDuckDbConnection();
    try {
      const records = (await dbConnection.runAndReadAll(
        sql,
        prepareBindings([...bindings])
      )).getRowObjectsJson() as any;
      return this.formatAggregateResult(records);
    } finally {
      if (!injected) {
        await releaseDuckDbConnection(dbConnection);
      }
    }
  }
}

export { StatsS3Search };
