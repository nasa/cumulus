import { Knex } from 'knex';
import omit from 'lodash/omit';
import Logger from '@cumulus/logger';

import { BaseRecord } from '../types/base';
import { getKnexClient } from '../connection';
import { TableNames } from '../tables';
import { DbQueryParameters, QueriableType, QueryEvent, QueryStringParameters } from '../types/search';
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
    this.buildTermsQuery({ countQuery, searchQuery });
    this.buildNotMatchQuery({ countQuery, searchQuery });
    this.buildRangeQuery({ countQuery, searchQuery });
    this.buildExistsQuery({ countQuery, searchQuery });
    this.buildInfixPrefixQuery({ countQuery, searchQuery });
    this.buildSortQuery({ searchQuery });

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
   * Build queries for checking if field 'exists'
   *
   * @param params
   * @param [params.countQuery] - query builder for getting count
   * @param params.searchQuery - query builder for search
   * @param [params.dbQueryParameters] - db query parameters
   */
  protected buildExistsQuery(params: {
    countQuery?: Knex.QueryBuilder,
    searchQuery: Knex.QueryBuilder,
    dbQueryParameters?: DbQueryParameters,
  }) {
    const { countQuery, searchQuery, dbQueryParameters } = params;
    const { exists = {} } = dbQueryParameters ?? this.dbQueryParameters;

    Object.entries(exists).forEach(([name, value]) => {
      const queryMethod = value ? 'whereNotNull' : 'whereNull';
      const checkNull = value ? 'not null' : 'null';
      switch (name) {
        case 'collectionName':
        case 'collectionVersion':
          [countQuery, searchQuery].forEach((query) => query?.[queryMethod](`${this.tableName}.collection_cumulus_id`));
          break;
        case 'providerName':
          [countQuery, searchQuery].forEach((query) => query?.[queryMethod](`${this.tableName}.provider_cumulus_id`));
          break;
        case 'pdrName':
          [countQuery, searchQuery].forEach((query) => query?.[queryMethod](`${this.tableName}.pdr_cumulus_id`));
          break;
        case 'error':
        case 'error.Error':
          [countQuery, searchQuery].forEach((query) => query?.whereRaw(`${this.tableName}.error ->> 'Error' is ${checkNull}`));
          break;
        default:
          [countQuery, searchQuery].forEach((query) => query?.[queryMethod](`${this.tableName}.${name}`));
          break;
      }
    });
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
    const {
      collections: collectionsTable,
      providers: providersTable,
      pdrs: pdrsTable,
    } = TableNames;

    const { countQuery, searchQuery, dbQueryParameters } = params;
    const { term = {} } = dbQueryParameters ?? this.dbQueryParameters;

    Object.entries(term).forEach(([name, value]) => {
      switch (name) {
        case 'collectionName':
          [countQuery, searchQuery].forEach((query) => query?.where(`${collectionsTable}.name`, value));
          break;
        case 'collectionVersion':
          [countQuery, searchQuery].forEach((query) => query?.where(`${collectionsTable}.version`, value));
          break;
        case 'providerName':
          [countQuery, searchQuery].forEach((query) => query?.where(`${providersTable}.name`, value));
          break;
        case 'pdrName':
          [countQuery, searchQuery].forEach((query) => query?.where(`${pdrsTable}.name`, value));
          break;
        case 'error.Error':
          [countQuery, searchQuery]
            .forEach((query) => query?.whereRaw(`${this.tableName}.error->>'Error' = '${value}'`));
          break;
        default:
          [countQuery, searchQuery].forEach((query) => query?.where(`${this.tableName}.${name}`, value));
          break;
      }
    });
  }

  /**
   * Build queries for terms fields
   *
   * @param params
   * @param [params.countQuery] - query builder for getting count
   * @param params.searchQuery - query builder for search
   * @param [params.dbQueryParameters] - db query parameters
   */
  protected buildTermsQuery(params: {
    countQuery?: Knex.QueryBuilder,
    searchQuery: Knex.QueryBuilder,
    dbQueryParameters?: DbQueryParameters,
  }) {
    const {
      collections: collectionsTable,
      providers: providersTable,
      pdrs: pdrsTable,
    } = TableNames;

    const { countQuery, searchQuery, dbQueryParameters } = params;
    const { terms = {} } = dbQueryParameters ?? this.dbQueryParameters;

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
      [countQuery, searchQuery]
        .forEach((query) => query?.whereIn([`${collectionsTable}.name`, `${collectionsTable}.version`], collectionPair));
    }

    Object.entries(omit(terms, ['collectionName', 'collectionVersion'])).forEach(([name, value]) => {
      switch (name) {
        case 'providerName':
          [countQuery, searchQuery].forEach((query) => query?.whereIn(`${providersTable}.name`, value));
          break;
        case 'pdrName':
          [countQuery, searchQuery].forEach((query) => query?.whereIn(`${pdrsTable}.name`, value));
          break;
        case 'error.Error':
          [countQuery, searchQuery]
            .forEach((query) => query?.whereRaw(`${this.tableName}.error->>'Error' in ('${value.join('\',\'')}')`));
          break;
        default:
          [countQuery, searchQuery].forEach((query) => query?.whereIn(`${this.tableName}.${name}`, value));
          break;
      }
    });
  }

  /**
   * Build queries for checking if field doesn't match the given value
   *
   * @param params
   * @param [params.countQuery] - query builder for getting count
   * @param params.searchQuery - query builder for search
   * @param [params.dbQueryParameters] - db query parameters
   */
  protected buildNotMatchQuery(params: {
    countQuery?: Knex.QueryBuilder,
    searchQuery: Knex.QueryBuilder,
    dbQueryParameters?: DbQueryParameters,
  }) {
    const {
      collections: collectionsTable,
      providers: providersTable,
      pdrs: pdrsTable,
    } = TableNames;

    const { countQuery, searchQuery, dbQueryParameters } = params;
    const { not: term = {} } = dbQueryParameters ?? this.dbQueryParameters;

    // collection name and version are searched in pair
    if (term.collectionName && term.collectionVersion) {
      [countQuery, searchQuery].forEach((query) => query?.whereNot({
        [`${collectionsTable}.name`]: term.collectionName,
        [`${collectionsTable}.version`]: term.collectionVersion,
      }));
    }
    Object.entries(omit(term, ['collectionName', 'collectionVersion'])).forEach(([name, value]) => {
      switch (name) {
        case 'providerName':
          [countQuery, searchQuery].forEach((query) => query?.whereNot(`${providersTable}.name`, value));
          break;
        case 'pdrName':
          [countQuery, searchQuery].forEach((query) => query?.whereNot(`${pdrsTable}.name`, value));
          break;
        case 'error.Error':
          [countQuery, searchQuery].forEach((query) => query?.whereRaw(`${this.tableName}.error->>'Error' != '${value}'`));
          break;
        default:
          [countQuery, searchQuery].forEach((query) => query?.whereNot(`${this.tableName}.${name}`, value));
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
   */
  protected buildSortQuery(params: {
    searchQuery: Knex.QueryBuilder,
    dbQueryParameters?: DbQueryParameters,
  }) {
    const { searchQuery, dbQueryParameters } = params;
    const { sort } = dbQueryParameters || this.dbQueryParameters;
    sort?.forEach((key) => {
      if (key.column.startsWith('error')) {
        searchQuery.orderByRaw(`${this.tableName}.error ->> 'Error' ${key.order}`);
      } else {
        searchQuery.orderBy([key]);
      }
    });
  }

  /**
   * Translate postgres records to api records
   *
   * @param pgRecords - postgres records returned from query
   * @throws - function is not implemented
   */
  protected translatePostgresRecordsToApiRecords(pgRecords: BaseRecord[], knex?: Knex) {
    log.error(`translatePostgresRecordsToApiRecords is not implemented ${pgRecords[0]} with client ${knex}`);
    throw new Error('translatePostgresRecordsToApiRecords is not implemented');
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
    try {
      const countResult = await countQuery;
      const meta = this._metaTemplate();
      meta.limit = this.dbQueryParameters.limit;
      meta.page = this.dbQueryParameters.page;
      meta.count = Number(countResult[0]?.count ?? 0);

      const pgRecords = await searchQuery;
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
