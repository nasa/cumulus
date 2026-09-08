import { executeDuckDBSearch } from './DuckDBSearchExecutor';
import { AsyncOperationSearch } from '../search/AsyncOperationSearch';

/**
 * Class to build and execute DuckDB search query for asyncOperation
 */
export class AsyncOperationIcebergSearch extends AsyncOperationSearch {
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
