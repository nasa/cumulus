import { DuckDBConnection } from '@duckdb/node-api';

import { DuckDBSearchExecutor } from './DuckDBSearchExecutor';
import { ReconciliationReportSearch } from '../search/ReconciliationReportSearch';
import { QueryEvent } from '../types/search';

/**
 * Class to build and execute DuckDB search query for Reconciliation Report
 */
export class ReconciliationReportS3Search extends ReconciliationReportSearch {
  private duckDBSearchExecutor: DuckDBSearchExecutor;

  constructor(event: QueryEvent, dbConnection: DuckDBConnection) {
    super(event);

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
