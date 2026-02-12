import { knex, Knex } from 'knex';
import { DuckDBConnection } from '@duckdb/node-api';
import Logger from '@cumulus/logger';

import { QueryEvent } from '../types/search';
import {
  ApiAggregateResult, StatsSearch, SummaryResult, TotalSummary,
} from '../search/StatsSearch';
import { prepareBindings } from './duckdbHelpers';

const log = new Logger({ sender: '@cumulus/db/StatsSearch' });

/**
 * A class to query postgres for the STATS and STATS/AGGREGATE endpoints
 */
class StatsS3Search extends StatsSearch {
  private duckDbConn: DuckDBConnection;
  private knexBuilder: Knex;

  constructor(event: QueryEvent, type: string, duckDbConn: DuckDBConnection) {
    super(event, type);
    this.duckDbConn = duckDbConn;
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
    log.debug(`summary about to execute query: ${aggregateQuery?.toSQL().sql}`);

    const { sql, bindings } = aggregateQuery.toSQL().toNative();
    const reader = await this.duckDbConn.runAndReadAll(
      sql,
      prepareBindings([...bindings]) // prepareBindings must be imported/defined in scope
    );

    const aggregateQueryRes: TotalSummary[] = reader.getRowObjectsJson() as any[];
    return this.formatSummaryResult(aggregateQueryRes[0]);
  }

  /**
   * Executes the aggregate search query
   *
   * @returns the aggregate query results in api format
   */
  async aggregate(): Promise<ApiAggregateResult> {
    const { searchQuery } = this.buildSearch(this.knexBuilder);
    const { sql, bindings } = searchQuery.toSQL().toNative();
    const reader = await this.duckDbConn.runAndReadAll(
      sql,
      prepareBindings([...bindings]) // prepareBindings must be imported/defined in scope
    );
    const records = reader.getRowObjectsJson() as any;
    return this.formatAggregateResult(records);
  }
}

export { StatsS3Search };
