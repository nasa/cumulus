import { executeDuckDBSearch } from './DuckDBSearchExecutor';
import { RuleSearch } from '../search/RuleSearch';

/**
 * Class to build and execute DuckDB search query for rules
 */
export class RuleIcebergSearch extends RuleSearch {
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
