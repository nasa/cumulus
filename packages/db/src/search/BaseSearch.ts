import { Knex } from 'knex';
import get from 'lodash/get';
import omit from 'lodash/omit';
import Logger from '@cumulus/logger';

import { BaseRecord } from '../types/base';
import { getKnexClient } from '../connection';
import { TableNames } from '../tables';
import { DbQueryParameters, QueryEvent, QueriableType, QueryStringParameters } from '../types/search';
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
   * Build the CTE search query
   *
   * @param knex - DB client
   * @returns queries for getting count and search result
   */
  protected buildCteSearch(knex: Knex)
    : {
      countQuery: Knex.QueryBuilder,
      searchQuery: Knex.QueryBuilder,
    } {
    const cteQueryBuilders : Record<string, Knex.QueryBuilder> = {};
    this.initCteTable({ knex, cteQueryBuilders, cteName: this.tableName });
    this.buildCteTermQuery({ knex, cteQueryBuilders });
    this.buildCteTermsQuery({ knex, cteQueryBuilders });
    this.buildCteNotMatchQuery({ knex, cteQueryBuilders });
    this.buildRangeQuery({ knex, cteQueryBuilder: cteQueryBuilders[`${this.tableName}`] });
    this.buildExistsQuery({ cteQueryBuilder: cteQueryBuilders[`${this.tableName}`] });
    this.buildInfixPrefixQuery({ cteQueryBuilder: cteQueryBuilders[`${this.tableName}`], cteName: `${this.tableName}` });
    const cteSearchQueryBuilder = knex.queryBuilder();
    const { cteSearchQueryBuilder: searchQuery } = this.joinCteTables(
      { cteSearchQueryBuilder, cteQueryBuilders }
    );

    const countQuery = searchQuery.clone();
    countQuery.clear('select').countDistinct(
      `${this.tableName}_cte.cumulus_id as count`
    );

    this.buildSortQuery({ searchQuery, cteName: `${this.tableName}_cte` });
    if (this.dbQueryParameters.limit) searchQuery.limit(this.dbQueryParameters.limit);
    if (this.dbQueryParameters.offset) searchQuery.offset(this.dbQueryParameters.offset);

    log.debug(`buildSearch returns countQuery: ${countQuery?.toSQL().sql}, searchQuery: ${searchQuery.toSQL().sql}`);
    return { countQuery, searchQuery };
  }

  /**
   * Builds the CTE Term query for term search
   *
   * @param params
   * @param params.knex - DB client
   * @param params.cteQueryBuilders - object of CTE query builders
   * @param [params.dbQueryParameters] - db query parameters
   * @throws - function is not implemented
   */
  protected buildCteTermQuery(params: {
    knex: Knex;
    cteQueryBuilders: Record<string, Knex.QueryBuilder>,
    dbQueryParameters?: DbQueryParameters,
  }) {
    log.debug(`buildCteTermQuery is not implemented ${Object.keys(params)}`);
    throw new Error('buildCteTermQuery is not implemented');
  }

  /**
   * Builds the CTE Terms query for terms search
   *
   * @param params
   * @param params.knex - DB client
   * @param params.cteQueryBuilders - object of CTE query builders
   * @param [params.dbQueryParameters] - db query parameters
   * @throws - function is not implemented
   */
  protected buildCteTermsQuery(params: {
    knex: Knex;
    cteQueryBuilders: Record<string, Knex.QueryBuilder>,
    dbQueryParameters?: DbQueryParameters,
  }) {
    log.debug(`buildCteTermsQuery is not implemented ${Object.keys(params)}`);
    throw new Error('buildCteTermsQuery is not implemented');
  }

  /**
   * Builds the CTE Not Match query for not match queries
   *
   * @param params
   * @param params.knex - DB client
   * @param params.cteQueryBuilders - object of query builders
   * @param [params.dbQueryParameters] - db query parameters
   * @throws - function is not implemented
   */
  protected buildCteNotMatchQuery(params: {
    knex: Knex,
    cteQueryBuilders: Record<string, Knex.QueryBuilder>,
    dbQueryParameters?: DbQueryParameters
  }) {
    log.debug(`buildCteNotMatchQuery is not implemented ${Object.keys(params)}`);
    throw new Error('buildCteNotMatchQuery is not implemented');
  }

  /**
   * Build Range query for CTE
   *
   * @param params
   * @param params.knex - db client
   * @param params.cteQueryBuilders - object that holds query builders
   * @param [params.dbQueryParameters] - db query parameters
   */
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
   * Joins the tables for the CTE query
   *
   * @param params
   * @param params.cteSearchQueryBuilder - search query builder
   * @param params.cteQueryBuilders - object that holds query builders
   * @returns - search query builder
   * @throws - function is not implemented
   */
  protected joinCteTables(params: {
    cteSearchQueryBuilder: Knex.QueryBuilder;
    cteQueryBuilders: Record<string, Knex.QueryBuilder>;
  })
    : {
      cteSearchQueryBuilder: Knex.QueryBuilder
    } {
    log.debug(`joinCteTables is not implemented ${Object.keys(params)}`);
    throw new Error('joinCteTables is not implemented');
  }

  /**
   * Build CTE tables
   *
   * @param params
   * @param params.knex - db client
   * @param params.cteQueryBuilders - object that holds query builders
   * @param params.term - term value to filter through for building the CTE
   */
  protected buildCteTables(params: {
    knex: Knex,
    cteQueryBuilders: Record<string, Knex.QueryBuilder>,
    term: any
  }) {
    const {
      collections: collectionsTable,
      providers: providersTable,
      pdrs: pdrsTable,
      asyncOperations: asyncOperationsTable,
      executions: executionsTable,
    } = TableNames;

    const { knex, cteQueryBuilders, term } = params;

    Object.keys(term).forEach((name) => {
      switch (name) {
        case 'collectionVersion':
        case 'collectionName':
          this.initCteTable({ knex, cteQueryBuilders, cteName: collectionsTable });
          break;
        case 'executionArn':
        case 'parentArn':
          this.initCteTable({ knex, cteQueryBuilders, cteName: executionsTable });
          break;
        case 'providerName':
          this.initCteTable({ knex, cteQueryBuilders, cteName: providersTable });
          break;
        case 'pdrName':
          this.initCteTable({ knex, cteQueryBuilders, cteName: pdrsTable });
          break;
        case 'asyncOperationId':
          this.initCteTable({ knex, cteQueryBuilders, cteName: asyncOperationsTable });
          break;
        case 'error.Error':
        default:
          this.initCteTable({ knex, cteQueryBuilders, cteName: this.tableName });
          break;
      }
    });
  }

  /**
   * Initialize CTE table
   *
   * @param params
   * @param params.knex - db client
   * @param params.cteQueryBuilders - object that holds query builders
   * @param params.cteName - CTE table name
   */
  protected initCteTable(params: {
    knex: Knex,
    cteQueryBuilders: Record<string, Knex.QueryBuilder>,
    cteName: string,
  }) {
    const { knex, cteQueryBuilders, cteName } = params;
    if (!(`${cteName}` in cteQueryBuilders)) cteQueryBuilders[`${cteName}`] = knex.select('*').from(`${cteName}`);
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
   * @returns CTE query builder for getting count and search
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
   * @param params.cteQueryBuilder - CTE query builder for search
   * @param [params.cteName] - CTE table name
   * @param [params.dbQueryParameters] - db query parameters
   * @throws - function is not implemented
   */
  protected buildInfixPrefixQuery(params: {
    cteQueryBuilder: Knex.QueryBuilder,
    cteName?: string,
    dbQueryParameters?: DbQueryParameters,
  }) {
    log.debug(`buildInfixPrefixQuery is not implemented ${Object.keys(params)}`);
    throw new Error('buildInfixPrefixQuery is not implemented');
  }

  /**
   * Build queries for checking if field 'exists'
   *
   * @param params
   * @param params.cteQueryBuilder - CTE query builder for search
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

  /**
   * Build queries for range fields
   *
   * @param params
   * @param params.cteQueryBuilder - CTE query builder for search
   * @param [params.knex] - db client
   * @param [params.dbQueryParameters] - db query parameters
   */
  protected buildRangeQuery(params: {
    cteQueryBuilder: Knex.QueryBuilder,
    knex?: Knex,
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

  /**
   * Build term query
   *
   * @param params
   * @param params.cteQueryBuilder - CTE query builder for search
   * @param [params.dbQueryParameters] - db query parameters
   */
  protected buildTermQuery(params: {
    cteQueryBuilder: Knex.QueryBuilder,
    dbQueryParameters?: DbQueryParameters,
  }) {
    const { cteQueryBuilder, dbQueryParameters } = params;
    const { term = {} } = dbQueryParameters ?? this.dbQueryParameters;
    const {
      collections: collectionsTable,
      providers: providersTable,
      pdrs: pdrsTable,
      asyncOperations: asyncOperationsTable,
      executions: executionsTable,
    } = TableNames;

    Object.entries(term).forEach(([name, value]) => {
      switch (name) {
        case 'collectionName':
          cteQueryBuilder.where(`${collectionsTable}.name`, value);
          break;
        case 'collectionVersion':
          cteQueryBuilder.where(`${collectionsTable}.version`, value);
          break;
        case 'executionArn':
          cteQueryBuilder.where(`${executionsTable}.arn`, value);
          break;
        case 'providerName':
          cteQueryBuilder.where(`${providersTable}.name`, value);
          break;
        case 'pdrName':
          cteQueryBuilder.where(`${pdrsTable}.name`, value);
          break;
        case 'error.Error':
          cteQueryBuilder.whereRaw(`${this.tableName}.error->>'Error' = ?`, value);
          break;
        case 'asyncOperationId':
          cteQueryBuilder.where(`${asyncOperationsTable}.id`, value);
          break;
        case 'parentArn':
          cteQueryBuilder.where(`${executionsTable}.parentArn`, value);
          break;
        default:
          cteQueryBuilder.where(`${this.tableName}.${name}`, value);
          break;
      }
    });
  }

  /**
   * Build terms query
   *
   * @param params
   * @param params.cteQueryBuilder - CTE query builder for search
   * @param [params.dbQueryParameters] - db query parameters
   */
  protected buildTermsQuery(params: {
    cteQueryBuilder: Knex.QueryBuilder,
    dbQueryParameters?: DbQueryParameters,
  }) {
    const { cteQueryBuilder, dbQueryParameters } = params;
    const { terms = {} } = dbQueryParameters ?? this.dbQueryParameters;
    const {
      collections: collectionsTable,
      providers: providersTable,
      pdrs: pdrsTable,
      asyncOperations: asyncOperationsTable,
      executions: executionsTable,
    } = TableNames;

    // collection name and version are searched in pair
    if (terms.collectionName && terms.collectionVersion
      && terms.collectionName.length > 0
      && terms.collectionVersion.length > 0) {
      const collectionPair: QueriableType[][] = [];
      for (let i = 0; i < terms.collectionName.length; i += 1) {
        const name = terms.collectionName[i];
        const version = terms.collectionVersion[i];
        if (name && version) collectionPair.push([name, version]);
      }
      cteQueryBuilder.whereIn([`${collectionsTable}.name`, `${collectionsTable}.version`], collectionPair);
    }

    Object.entries(omit(terms, ['collectionName', 'collectionVersion'])).forEach(([name, value]) => {
      switch (name) {
        case 'collectionName':
          cteQueryBuilder.whereIn(`${collectionsTable}.name`, value);
          break;
        case 'collectionVersion':
          cteQueryBuilder.whereIn(`${collectionsTable}.version`, value);
          break;
        case 'executionArn':
          cteQueryBuilder.whereIn(`${executionsTable}.arn`, value);
          break;
        case 'providerName':
          cteQueryBuilder.whereIn(`${providersTable}.name`, value);
          break;
        case 'pdrName':
          cteQueryBuilder.whereIn(`${pdrsTable}.name`, value);
          break;
        case 'error.Error':
          if (Array.isArray(value) && value.length > 0) {
            cteQueryBuilder.whereRaw(
              `${this.tableName}.error->>'Error' IN (${value.map(() => '?').join(',')})`,
              value
            );
          }
          break;
        case 'asyncOperationId':
          cteQueryBuilder.whereIn(`${asyncOperationsTable}.id`, value);
          break;
        case 'parentArn':
          cteQueryBuilder.whereIn(`${executionsTable}.parentArn`, value);
          break;
        default:
          cteQueryBuilder.whereIn(`${this.tableName}.${name}`, value);
          break;
      }
    });
  }

  /**
   * Build not matches query
   *
   * @param params
   * @param params.cteQueryBuilder - CTE query builder for search
   * @param [params.dbQueryParameters] - db query parameters
   */
  protected buildNotMatchQuery(params: {
    cteQueryBuilder: Knex.QueryBuilder,
    dbQueryParameters?: DbQueryParameters,
  }) {
    const { cteQueryBuilder, dbQueryParameters } = params;
    const { not: term = {} } = dbQueryParameters ?? this.dbQueryParameters;
    const {
      collections: collectionsTable,
      providers: providersTable,
      pdrs: pdrsTable,
      asyncOperations: asyncOperationsTable,
      executions: executionsTable,
    } = TableNames;

    // collection name and version are searched in pair
    if (term.collectionName && term.collectionVersion) {
      cteQueryBuilder.whereNot({
        [`${collectionsTable}.name`]: term.collectionName,
        [`${collectionsTable}.version`]: term.collectionVersion,
      });
    }

    Object.entries(omit(term, ['collectionName', 'collectionVersion'])).forEach(([name, value]) => {
      switch (name) {
        case 'collectionName':
          cteQueryBuilder.whereNot(`${collectionsTable}.name`, value);
          break;
        case 'collectionVersion':
          cteQueryBuilder.whereNot(`${collectionsTable}.version`, value);
          break;
        case 'executionArn':
          cteQueryBuilder.whereNot(`${executionsTable}.arn`, value);
          break;
        case 'providerName':
          cteQueryBuilder.whereNot(`${providersTable}.name`, value);
          break;
        case 'pdrName':
          cteQueryBuilder.whereNot(`${pdrsTable}.name`, value);
          break;
        case 'error.Error':
          cteQueryBuilder.whereRaw(`${this.tableName}.error->>'Error' != ?`, value);
          break;
        case 'asyncOperationId':
          cteQueryBuilder.whereNot(`${asyncOperationsTable}.id`, value);
          break;
        case 'parentArn':
          cteQueryBuilder.whereNot(`${executionsTable}.parentArn`, value);
          break;
        default:
          cteQueryBuilder.whereNot(`${this.tableName}.${name}`, value);
          break;
      }
    });
  }

  /**
   * Build queries for sort keys and fields
   *
   * @param params
   * @param params.searchQuery - query builder for search
   * @param [params.dbQueryParameters] - db query parameters
   * @param [params.cteName] - CTE table name
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
