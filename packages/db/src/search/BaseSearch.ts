import { Knex } from 'knex';
import get from 'lodash/get';
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
  reconciliationReport: TableNames.reconciliationReports,
};

/**
 * Class to build and execute db search query
 */

abstract class BaseSearch {
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
   * check if joined collections table search is needed
   *
   * @returns whether collection search is needed
   */
  protected searchCollection(): boolean {
    const { not, term, terms } = this.dbQueryParameters;
    return !!(not?.collectionName
      || not?.collectionVersion
      || term?.collectionName
      || term?.collectionVersion
      || terms?.collectionName
      || terms?.collectionVersion);
  }

  /**
   * check if joined executions table search is needed
   *
   * @returns whether execution search is needed
   */
  protected searchExecution(): boolean {
    const { not, term, terms } = this.dbQueryParameters;
    return !!(not?.executionArn || term?.executionArn || terms?.executionArn);
  }

  /**
   * check if joined pdrs table search is needed
   *
   * @returns whether pdr search is needed
   */
  protected searchPdr(): boolean {
    const { not, term, terms } = this.dbQueryParameters;
    return !!(not?.pdrName || term?.pdrName || terms?.pdrName);
  }

  /**
   * check if joined providers table search is needed
   *
   * @returns whether provider search is needed
   */
  protected searchProvider(): boolean {
    const { not, term, terms } = this.dbQueryParameters;
    return !!(not?.providerName || term?.providerName || terms?.providerName);
  }

  /**
   * Determine if an estimated row count should be returned
   *
   * @param countSql - sql statement for count
   * @returns whether an estimated row count should be returned
   */
  protected shouldEstimateRowcount(countSql: string): boolean {
    const isBasicQuery = (countSql === `select count(*) from "${this.tableName}"`);
    return this.dbQueryParameters.estimateTableRowCount === true && isBasicQuery;
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
    const { cteQueryBuilder } = this.buildBasicQuery(knex);
    this.buildTermQuery({ cteQueryBuilder });
    this.buildTermsQuery({ cteQueryBuilder });
    this.buildNotMatchQuery({ cteQueryBuilder });
    this.buildRangeQuery({ knex, cteQueryBuilder });
    this.buildExistsQuery({ cteQueryBuilder });
    this.buildInfixPrefixQuery({ cteQueryBuilder });

    const cteName = `${this.tableName}_cte`;

    const searchQuery = knex.with(cteName, cteQueryBuilder)
      .select(`${cteName}.*`)
      .from(cteName);

    this.buildJoins({ searchQuery, cteName });

    const countQuery = knex.with(cteName, cteQueryBuilder)
      .from(cteName)
      .countDistinct(`${cteName}.cumulus_id as count`);

    this.buildSortQuery({ searchQuery, cteName });
    if (this.dbQueryParameters.limit) searchQuery.limit(this.dbQueryParameters.limit);
    if (this.dbQueryParameters.offset) searchQuery.offset(this.dbQueryParameters.offset);
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
   * @returns queries for getting count and search result
   */
  protected buildBasicQuery(knex: Knex): {
    cteQueryBuilder: Knex.QueryBuilder,
  } {
    const cteQueryBuilder = knex.select('*').from(this.tableName);
    return { cteQueryBuilder };
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
    cteQueryBuilder: Knex.QueryBuilder,
    dbQueryParameters?: DbQueryParameters,
  }) {
    log.debug(`buildInfixPrefixQuery is not implemented ${Object.keys(params)}`);
    throw new Error('buildInfixPrefixQuery is not implemented');
  }

  protected buildJoins(params: {
    searchQuery: Knex.QueryBuilder,
    cteName: string
  }) {
    log.debug(`buildJoins is not implemented ${Object.keys(params)}`);
    throw new Error('buildJoins is not implemented');
  }

  /**
   * Build queries for checking if field 'exists'
   *
   * @param params
   * @param [params.countQuery] - query builder for getting count
   * @param params.searchQuery - query builder for search
   * @param [params.dbQueryParameters] - db query parameters
   */
  protected buildExistsQuery(params: {
    cteQueryBuilder: Knex.QueryBuilder,
    dbQueryParameters?: DbQueryParameters,
  }) {
    const { cteQueryBuilder, dbQueryParameters } = params;
    const { exists = {} } = dbQueryParameters ?? this.dbQueryParameters;

    Object.entries(exists).forEach(([name, value]) => {
      const queryMethod = value ? 'whereNotNull' : 'whereNull';
      const checkNull = value ? 'not null' : 'null';
      switch (name) {
        case 'collectionName':
        case 'collectionVersion':
          cteQueryBuilder[queryMethod](`${this.tableName}.collection_cumulus_id`);
          break;
        case 'executionArn':
          cteQueryBuilder[queryMethod](`${this.tableName}.execution_cumulus_id`);
          break;
        case 'providerName':
          cteQueryBuilder[queryMethod](`${this.tableName}.provider_cumulus_id`);
          break;
        case 'pdrName':
          cteQueryBuilder[queryMethod](`${this.tableName}.pdr_cumulus_id`);
          break;
        case 'asyncOperationId':
          cteQueryBuilder[queryMethod](`${this.tableName}.async_operation_cumulus_id`);
          break;
        case 'error':
        case 'error.Error':
          cteQueryBuilder.whereRaw(`${this.tableName}.error ->> 'Error' is ${checkNull}`);
          break;
        case 'parentArn':
          cteQueryBuilder[queryMethod](`${this.tableName}.parent_cumulus_id`);
          break;
        default:
          cteQueryBuilder[queryMethod](`${this.tableName}.${name}`);
          break;
      }
    });
  }

  protected buildCTEExistsQuery(params: {
    knex: Knex,
    cteQueryBuilders: Record<string, Knex.QueryBuilder>,
    dbQueryParameters?: DbQueryParameters,
  }) {
    const { knex, cteQueryBuilders, dbQueryParameters } = params;
    const { exists = {} } = dbQueryParameters ?? this.dbQueryParameters;

    if (!(`${this.tableName}` in cteQueryBuilders)) cteQueryBuilders[`${this.tableName}`] = knex.select('*').from(`${this.tableName}`);

    Object.entries(exists).forEach(([name, value]) => {
      const queryMethod = value ? 'whereNotNull' : 'whereNull';
      const checkNull = value ? 'not null' : 'null';
      switch (name) {
        case 'collectionName':
        case 'collectionVersion':
          cteQueryBuilders[`${this.tableName}`][queryMethod](`${this.tableName}.collection_cumulus_id`);
          break;
        case 'executionArn':
          cteQueryBuilders[`${this.tableName}`][queryMethod](`${this.tableName}.execution_cumulus_id`);
          break;
        case 'providerName':
          cteQueryBuilders[`${this.tableName}`][queryMethod](`${this.tableName}.provider_cumulus_id`);
          break;
        case 'pdrName':
          cteQueryBuilders[`${this.tableName}`][queryMethod](`${this.tableName}.pdr_cumulus_id`);
          break;
        case 'asyncOperationId':
          cteQueryBuilders[`${this.tableName}`][queryMethod](`${this.tableName}.async_operation_cumulus_id`);
          break;
        case 'error':
        case 'error.Error':
          cteQueryBuilders[`${this.tableName}`].whereRaw(`${this.tableName}.error ->> 'Error' is ${checkNull}`);
          break;
        case 'parentArn':
          cteQueryBuilders[`${this.tableName}`][queryMethod](`${this.tableName}.parent_cumulus_id`);
          break;
        default:
          cteQueryBuilders[`${this.tableName}`][queryMethod](`${this.tableName}.${name}`);
          break;
      }
    });
  }

  protected buildCTETermQuery(params: {
    knex: Knex,
    cteQueryBuilders: Record<string, Knex.QueryBuilder>,
    dbQueryParameters?: DbQueryParameters,
  }) {
    log.debug(`buildInfixPrefixQuery is not implemented ${Object.keys(params)}`);
    throw new Error('buildInfixPrefixQuery is not implemented');
  }

  /**
   * Build queries for range fields
   *
   * @param params
   * @param params.knex - db client
   * @param [params.countQuery] - query builder for getting count
   * @param params.searchQuery - query builder for search
   * @param [params.dbQueryParameters] - db query parameters
   */
  protected buildRangeQuery(params: {
    knex?: Knex,
    cteQueryBuilder: Knex.QueryBuilder,
    dbQueryParameters?: DbQueryParameters,
  }) {
    const { cteQueryBuilder, dbQueryParameters } = params;
    const { range = {} } = dbQueryParameters ?? this.dbQueryParameters;

    Object.entries(range).forEach(([name, rangeValues]) => {
      const { gte, lte } = rangeValues;
      if (gte) {
        cteQueryBuilder.where(`${this.tableName}.${name}`, '>=', gte);
      }
      if (lte) {
        cteQueryBuilder.where(`${this.tableName}.${name}`, '<=', lte);
      }
    });
  }

  protected buildTermQuery(params: {
    cteQueryBuilder: Knex.QueryBuilder,
    dbQueryParameters?: DbQueryParameters,
  }) {
    log.debug(`buildTermQuery is not implemented ${Object.keys(params)}`);
    throw new Error('buildTermQuery is not implemented');
  }

  protected buildTermsQuery(params: {
    cteQueryBuilder: Knex.QueryBuilder,
    dbQueryParameters?: DbQueryParameters,
  }) {
    log.debug(`buildTermsQuery is not implemented ${Object.keys(params)}`);
    throw new Error('buildTermsQuery is not implemented');
  }

  protected buildNotMatchQuery(params: {
    cteQueryBuilder: Knex.QueryBuilder,
    dbQueryParameters?: DbQueryParameters,
  }) {
    log.debug(`buildNotMatchQuery is not implemented ${Object.keys(params)}`);
    throw new Error('buildNotMatchQuery is not implemented');
  }

  /**
   * Build queries for sort keys and fields
   *
   * @param params
   * @param params.searchQuery - query builder for search
   * @param [params.dbQueryParameters] - db query parameters
   */
  protected buildSortQuery(params: {
    searchQuery: Knex.QueryBuilder,
    dbQueryParameters?: DbQueryParameters,
    cteName?: string,
  }) {
    const { searchQuery, dbQueryParameters, cteName } = params;
    const { sort } = dbQueryParameters || this.dbQueryParameters;
    const table = cteName || this.tableName;

    sort?.forEach((key) => {
      if (key.column.startsWith('error')) {
        searchQuery.orderByRaw(
          `${table}.error ->> 'Error' ${key.order}`
        );
      } else if (dbQueryParameters?.collate) {
        searchQuery.orderByRaw(
          `${key} collate \"${dbQueryParameters.collate}\"`
        );
      } else {
        searchQuery.orderBy([key]);
      }
    });
  }

  /**
   * Translate postgres records to api records
   *
   * @param pgRecords - postgres records returned from query
   * @param [knex] - knex client for additional queries if neccessary
   * @throws - function is not implemented
   */
  protected translatePostgresRecordsToApiRecords(pgRecords: BaseRecord[], knex?: Knex) {
    log.error(`translatePostgresRecordsToApiRecords is not implemented ${pgRecords[0]} with client ${knex}`);
    throw new Error('translatePostgresRecordsToApiRecords is not implemented');
  }

  /**
   * Get estimated table rowcount
   *
   * @param params
   * @param params.knex - DB client
   * @param [params.tableName] - table name
   * @returns rowcount
   */
  protected async getEstimatedRowcount(params: {
    knex: Knex,
    tableName? : string,
  }) : Promise<number> {
    const { knex, tableName = this.tableName } = params;
    const query = knex.raw('EXPLAIN (FORMAT JSON) select * from ??', tableName);
    log.debug(`Estimating the row count ${query.toSQL().sql}`);
    const countResult = await query;
    const countPath = 'rows[0]["QUERY PLAN"][0].Plan["Plan Rows"]';
    const estimatedCount = get(countResult, countPath);
    const count = Number(estimatedCount ?? 0);
    return count;
  }

  protected buildCTERangeQuery(params: {
    knex: Knex,
    cteQueryBuilders: Record<string, Knex.QueryBuilder>,
    dbQueryParameters?: DbQueryParameters,
  }) {
    const { knex, cteQueryBuilders, dbQueryParameters } = params;
    const { range = {} } = dbQueryParameters ?? this.dbQueryParameters;
    if (!(`${this.tableName}` in cteQueryBuilders)) cteQueryBuilders[`${this.tableName}`] = knex.select('*').from(`${this.tableName}`);

    Object.entries(range).forEach(([name, rangeValues]) => {
      const { gte, lte } = rangeValues;
      if (gte) {
        cteQueryBuilders[`${this.tableName}`].where(`${this.tableName}.${name}`, '>=', gte);
      }
      if (lte) {
        cteQueryBuilders[`${this.tableName}`].where(`${this.tableName}.${name}`, '<=', lte);
      }
    });
  }

  /**
   * Build and execute search query
   *
   * @param testKnex - knex for testing
   * @returns search result
   */
  async query(testKnex?: Knex) {
    const knex = testKnex ?? await getKnexClient();
    const { countQuery, searchQuery } = this.buildSearch(knex);

    const shouldEstimateRowcount = countQuery
      ? this.shouldEstimateRowcount(countQuery?.toSQL().sql)
      : false;
    const getEstimate = shouldEstimateRowcount
      ? this.getEstimatedRowcount({ knex })
      : undefined;
    const shouldReturnCountOnly = this.dbQueryParameters.countOnly === true;

    try {
      const [countResult, pgRecords] = await Promise.all([
        getEstimate || countQuery,
        shouldReturnCountOnly ? [] : searchQuery,
      ]);
      const meta = this._metaTemplate();
      meta.limit = this.dbQueryParameters.limit;
      meta.page = this.dbQueryParameters.page;
      meta.count = shouldEstimateRowcount ? countResult : Number(countResult[0]?.count ?? 0);

      const apiRecords = await this.translatePostgresRecordsToApiRecords(pgRecords, knex);

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
