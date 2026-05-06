import { executeDuckDBSearch } from './DuckDBSearchExecutor';
import { ExecutionSearch } from '../search/ExecutionSearch';
import { QueryEvent } from '../types/search';

/**
 * Class to build and execute DuckDB search query for executions
 */
export class ExecutionIcebergSearch extends ExecutionSearch {
  constructor(event: QueryEvent) {
    super(event, false); // disables estimateTableRowCount
  }

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
