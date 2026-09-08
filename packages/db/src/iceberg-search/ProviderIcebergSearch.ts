import { executeDuckDBSearch } from './DuckDBSearchExecutor';
import { ProviderSearch } from '../search/ProviderSearch';

/**
 * Class to build and execute DuckDB search query for providers
 */
export class ProviderIcebergSearch extends ProviderSearch {
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
