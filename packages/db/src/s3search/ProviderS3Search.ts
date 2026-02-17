import { DuckDBConnection } from '@duckdb/node-api';

import { DuckDBSearchExecutor } from './DuckDBSearchExecutor';
import { ProviderSearch } from '../search/ProviderSearch';
import { QueryEvent } from '../types/search';

/**
 * Class to build and execute db search query for PDRs
 */
export class ProviderS3Search extends ProviderSearch {
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
