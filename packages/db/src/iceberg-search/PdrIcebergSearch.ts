import { executeDuckDBSearch } from './DuckDBSearchExecutor';
import { PdrSearch } from '../search/PdrSearch';

/**
 * Class to build and execute DuckDB search query for PDRs
 */
export class PdrIcebergSearch extends PdrSearch {
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
