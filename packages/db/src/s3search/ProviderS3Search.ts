import { DuckDBConnection } from '@duckdb/node-api';

import { executeDuckDBSearch } from './DuckDBSearchExecutor';
import { ProviderSearch } from '../search/ProviderSearch';
import { QueryEvent } from '../types/search';

/**
 * Class to build and execute DuckDB search query for providers
 */
export class ProviderS3Search extends ProviderSearch {
  private readonly dbConnection: DuckDBConnection | undefined;

  constructor(event: QueryEvent, dbConnection?: DuckDBConnection) {
    super(event);
    this.dbConnection = dbConnection;
  }

  /**
   * Build and execute search query.
   * Uses the connection supplied at construction time (e.g. in tests), or
   * borrows one from the pool and releases it when done.
   *
   * @returns search result
   */
  async query() {
    return executeDuckDBSearch({
      injectedConnection: this.dbConnection,
      dbQueryParameters: this.dbQueryParameters,
      getMetaTemplate: this._metaTemplate.bind(this),
      makeTranslateRecords: () => this.translatePostgresRecordsToApiRecords.bind(this),
      buildSearch: (knexBuilder) => this.buildSearch(knexBuilder),
    });
  }
}
