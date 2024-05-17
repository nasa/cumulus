import { Knex } from 'knex';
import Logger from '@cumulus/logger';

import { BaseRecord } from '../types/base';
import { getKnexClient } from '../connection';
import { TableNames } from '../tables';
import { DbQueryParameters, QueryEvent, QueryStringParameters } from '../types/search';
import { convertQueryStringToDbQueryParameters } from './queries';

const log = new Logger({ sender: '@cumulus/db/BaseSearch' });

type Meta = {
  name: string,
  stack?: string,
  table?: string,
  limit?: number,
  page?: number,
  count?: number,
};

export const typeToTable: { [key: string]: string } = {
  asyncOperation: TableNames.asyncOperations,
  collection: TableNames.collections,
  execution: TableNames.executions,
  granule: TableNames.granules,
  pdr: TableNames.pdrs,
  provider: TableNames.providers,
  rule: TableNames.rules,
};

/**
 * Class to build and execute db search query
 */
class BaseSearch {
  readonly type: string;
  readonly tableName: string;
  readonly queryStringParameters: QueryStringParameters;
  // parsed from queryStringParameters for query build
  dbQueryParameters: DbQueryParameters = {};

  constructor(event: QueryEvent, type: string) {
    this.type = type;
    this.tableName = typeToTable[this.type];
    this.queryStringParameters = event?.queryStringParameters ?? {};
    this.dbQueryParameters = convertQueryStringToDbQueryParameters(
      this.type, this.queryStringParameters
    );
  }

  /**
   * Build the search query
   *
   * @param knex - DB client
   * @returns queries for getting count and search result
   */
  protected buildSearch(knex: Knex)
    : {
      countQuery?: Knex.QueryBuilder,
      searchQuery: Knex.QueryBuilder,
    } {
    const { countQuery, searchQuery } = this.buildBasicQuery(knex);
    this.buildTermQuery({ countQuery, searchQuery });
    this.buildRangeQuery({ countQuery, searchQuery });
    this.buildInfixPrefixQuery({ countQuery, searchQuery });

    const { limit, offset } = this.dbQueryParameters;
    if (limit) searchQuery.limit(limit);
    if (offset) searchQuery.offset(offset);

    log.debug(`buildSearch returns countQuery: ${countQuery?.toSQL().sql}, searchQuery: ${searchQuery.toSQL().sql}`);
    return { countQuery, searchQuery };
  }

  /**
   * Get metadata template for query result
   *
   * @returns metadata template
   */
  private _metaTemplate(): Meta {
    return {
      name: 'cumulus-api',
      stack: process.env.stackName,
      table: this.tableName,
    };
  }

  /**
   * Build basic query
   *
   * @param knex - DB client
   * @throws - function is not implemented
   */
  protected buildBasicQuery(knex: Knex): {
    countQuery?: Knex.QueryBuilder,
    searchQuery: Knex.QueryBuilder,
  } {
    log.debug(`buildBasicQuery is not implemented ${knex.constructor.name}`);
    throw new Error('buildBasicQuery is not implemented');
  }

  /**
   * Build queries for infix and prefix
   *
   * @param params
   * @param [params.countQuery] - query builder for getting count
   * @param params.searchQuery - query builder for search
   * @param [params.dbQueryParameters] - db query parameters
   */
  protected buildInfixPrefixQuery(params: {
    countQuery?: Knex.QueryBuilder,
    searchQuery: Knex.QueryBuilder,
    dbQueryParameters?: DbQueryParameters,
  }) {
    log.debug(`buildInfixPrefixQuery is not implemented ${Object.keys(params)}`);
    throw new Error('buildInfixPrefixQuery is not implemented');
  }

  /**
   * Build queries for range fields
   *
   * @param params
   * @param [params.countQuery] - query builder for getting count
   * @param params.searchQuery - query builder for search
   * @param [params.dbQueryParameters] - db query parameters
   */
  protected buildRangeQuery(params: {
    countQuery?: Knex.QueryBuilder,
    searchQuery: Knex.QueryBuilder,
    dbQueryParameters?: DbQueryParameters,
  }) {
    const { countQuery, searchQuery, dbQueryParameters } = params;
    const { range = {} } = dbQueryParameters ?? this.dbQueryParameters;

    Object.entries(range).forEach(([name, rangeValues]) => {
      if (rangeValues.gte) {
        countQuery?.where(`${this.tableName}.${name}`, '>=', rangeValues.gte);
        searchQuery.where(`${this.tableName}.${name}`, '>=', rangeValues.gte);
      }
      if (rangeValues.lte) {
        countQuery?.where(`${this.tableName}.${name}`, '<=', rangeValues.lte);
        searchQuery.where(`${this.tableName}.${name}`, '<=', rangeValues.lte);
      }
    });
  }
  /**
   * Build queries for term fields
   *
   * @param params
   * @param [params.countQuery] - query builder for getting count
   * @param params.searchQuery - query builder for search
   * @param [params.dbQueryParameters] - db query parameters
   */
  protected buildTermQuery(params: {
    countQuery?: Knex.QueryBuilder,
    searchQuery: Knex.QueryBuilder,
    dbQueryParameters?: DbQueryParameters,
  }) {
    const { countQuery, searchQuery, dbQueryParameters } = params;
    const { term = {} } = dbQueryParameters || this.dbQueryParameters;

    Object.entries(term).forEach(([name, value]) => {
      countQuery?.where(`${this.tableName}.${name}`, value);
      searchQuery.where(`${this.tableName}.${name}`, value);
    });
  }

  /**
   * Translate postgres records to api records
   *
   * @param pgRecords - postgres records returned from query
   * @throws - function is not implemented
   */
  protected translatePostgresRecordsToApiRecords(pgRecords: BaseRecord[]) {
    log.error(`translatePostgresRecordsToApiRecords is not implemented ${pgRecords[0]}`);
    throw new Error('translatePostgresRecordsToApiRecords is not implemented');
  }

  /**
   * Build and execute search query
   *
   * @param testKnex - knex for testing
   * @returns search result
   */
  async query(testKnex: Knex | undefined) {
    const knex = testKnex ?? await getKnexClient();
    const { countQuery, searchQuery } = this.buildSearch(knex);
    try {
      const countResult = await countQuery;
      const meta = this._metaTemplate();
      meta.limit = this.dbQueryParameters.limit;
      meta.page = this.dbQueryParameters.page;
      meta.count = Number(countResult[0]?.count ?? 0);

      const pgRecords = await searchQuery;
      const apiRecords = this.translatePostgresRecordsToApiRecords(pgRecords);

      return {
        meta,
        results: apiRecords,
      };
    } catch (error) {
      log.error(`Error caught in search query for ${JSON.stringify(this.queryStringParameters)}`, error);
      return error;
    }
  }
}

export { BaseSearch };
