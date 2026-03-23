import { knex, Knex } from 'knex';
import { DuckDBConnection } from '@duckdb/node-api';

import { prepareBindings } from './duckdbHelpers';
import { Meta } from '../search/BaseSearch';
import { DbQueryParameters } from '../types/search';

/**
 * DuckDBSearchExecutor is a helper class for executing search queries on DuckDB.
 * It wraps a DuckDB connection and provides a unified method to:
 *   - Build queries using Knex (Postgres dialect)
 *   - Execute them sequentially to avoid prepared statement conflicts
 *   - Transform raw database records into API-ready records
 *
 * This class is intended to be used by S3Search subclasses that inherit
 * from BaseSearch, allowing them to reuse query logic while providing
 * custom record translation.
 */
export class DuckDBSearchExecutor {
  private dbConnection: DuckDBConnection;
  private knexBuilder: Knex;
  private dbQueryParameters: DbQueryParameters;
  private getMetaTemplate: () => Meta;
  private translateRecords: (
    records: any[],
    knexClient: Knex
  ) => any[] | Promise<any[]>;

  constructor(params: {
    dbConnection: DuckDBConnection;
    dbQueryParameters: DbQueryParameters;
    getMetaTemplate: () => Meta;
    translateRecords: (
      records: any[],
      knexClient: Knex
    ) => any[] | Promise<any[]>;
  }) {
    this.dbConnection = params.dbConnection;
    this.dbQueryParameters = params.dbQueryParameters;
    this.getMetaTemplate = params.getMetaTemplate;
    this.translateRecords = params.translateRecords;

    // Use pg dialect to generate DuckDB-compatible SQL ($1, $2, etc.)
    this.knexBuilder = knex({ client: 'pg' });
  }

  async query(
    buildSearch: (knex: Knex) => {
      countQuery?: Knex.QueryBuilder;
      searchQuery: Knex.QueryBuilder;
    }
  ) {
    const { countQuery, searchQuery } = buildSearch(this.knexBuilder);
    const shouldReturnCountOnly = this.dbQueryParameters.countOnly === true;

    const queryConfigs = shouldReturnCountOnly
      ? [{ key: 'count', query: countQuery }]
      : [
        { key: 'count', query: countQuery },
        { key: 'records', query: searchQuery },
      ];

    let countResult: any[] = [];
    let records: any[] = [];

    // sequential execution (DuckDB cannot handle multiple prepared statements simultaneously)
    for (const config of queryConfigs.filter((c) => c.query)) {
      const { sql, bindings } = config.query!.clone().toSQL().toNative();
      // eslint-disable-next-line no-await-in-loop
      const reader = await this.dbConnection.runAndReadAll(sql, prepareBindings(bindings));
      const result = reader.getRowObjectsJson();

      if (config.key === 'count') countResult = result;
      else records = result;
    }

    const meta = this.getMetaTemplate();
    meta.limit = this.dbQueryParameters.limit;
    meta.page = this.dbQueryParameters.page;
    meta.count = Number(countResult[0]?.count ?? 0);

    const apiRecords = await this.translateRecords(records, this.knexBuilder);
    return { meta, results: apiRecords };
  }
}
