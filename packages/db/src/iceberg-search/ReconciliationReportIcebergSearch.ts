import { executeDuckDBSearch } from './DuckDBSearchExecutor';
import { ReconciliationReportSearch } from '../search/ReconciliationReportSearch';

/**
 * Class to build and execute DuckDB search query for Reconciliation Report
 */
export class ReconciliationReportIcebergSearch extends ReconciliationReportSearch {
  /**
   * Build and execute search query.
   *
   * @returns search result
   */
  async query() {
    return executeDuckDBSearch({
      dbQueryParameters: this.dbQueryParameters,
      getMetaTemplate: this._metaTemplate.bind(this),
      makeTranslateRecords: () => this.translatePostgresRecordsToApiRecords.bind(this),
      buildSearch: (knexBuilder) => this.buildSearch(knexBuilder),
    });
  }
}
