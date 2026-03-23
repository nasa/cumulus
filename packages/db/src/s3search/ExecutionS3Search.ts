import { DuckDBConnection } from '@duckdb/node-api';

import { DuckDBSearchExecutor } from './DuckDBSearchExecutor';
import { ExecutionSearch } from '../search/ExecutionSearch';
import { QueryEvent } from '../types/search';

/**
 * Class to build and execute DuckDB search query for executions
 */
export class ExecutionS3Search extends ExecutionSearch {
  private duckDBSearchExecutor: DuckDBSearchExecutor;

  constructor(event: QueryEvent, dbConnection: DuckDBConnection) {
    super(event, false); // disables estimateTableRowCount

    this.duckDBSearchExecutor = new DuckDBSearchExecutor({
      dbConnection,
      dbQueryParameters: this.dbQueryParameters,
      getMetaTemplate: this._metaTemplate.bind(this),
      translateRecords: this.translatePostgresRecordsToApiRecords.bind(this),
    });
  }

  /**
   * Build and execute search query
   *
   * @returns search result
   */
  async query() {
    return this.duckDBSearchExecutor.query((knexBuilder) =>
      this.buildSearch(knexBuilder));
  }
}
