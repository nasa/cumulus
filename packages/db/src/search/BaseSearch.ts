import { Knex } from 'knex';
import Logger from '@cumulus/logger';
import { BaseRecord } from '../types/base';
import { getKnexClient } from '../connection';
import { TableNames } from '../tables';
import { DbQueryParameters, QueryEvent, QueryStringParameters } from '../types/search';
import { buildDbQueryParameters } from './queries';

const log = new Logger({ sender: '@cumulus/db/BaseSearch' });

export type Meta = {
  name: string,
  stack?: string,
  table?: string,
  limit?: number,
  page?: number,
  count?: number,
};

const typeToTable: { [key: string]: string } = {
  granule: TableNames.granules,
};

/**
 * Class to build and execute db search query
 */
class BaseSearch {
  readonly type: string;
  readonly queryStringParameters: QueryStringParameters;
  // parsed from queryStringParameters for query build
  dbQueryParameters: DbQueryParameters = {};

  constructor(event: QueryEvent, type: string) {
    this.type = type;
    this.queryStringParameters = event?.queryStringParameters ?? {};
    this.dbQueryParameters = buildDbQueryParameters(this.type, this.queryStringParameters);
  }

  /**
   * build the search query
   *
   * @param knex - DB client
   * @returns queries for getting count and search result
   */
  private _buildSearch(knex: Knex)
    : {
      countQuery: Knex.QueryBuilder,
      searchQuery: Knex.QueryBuilder,
    } {
    const { countQuery, searchQuery } = this.buildBasicQuery(knex);
    this.buildTermQuery({ countQuery, searchQuery });
    this.buildInfixPrefixQuery({ countQuery, searchQuery });

    const { limit, offset } = this.dbQueryParameters;
    if (limit) searchQuery.limit(limit);
    if (offset) searchQuery.offset(offset);

    log.debug(`_buildSearch returns countQuery ${countQuery.toSQL().sql}, searchQuery ${searchQuery.toSQL().sql}`);
    return { countQuery, searchQuery };
  }

  /**
   * metadata template for query result
   *
   * @returns metadata template
   */
  private _metaTemplate(): Meta {
    return {
      name: 'cumulus-api',
      stack: process.env.stackName,
      table: this.type && typeToTable[this.type],
    };
  }

  /**
   * build basic query
   *
   * @param knex - DB client
   * @throws - function is not implemented
   */
  protected buildBasicQuery(knex: Knex): {
    countQuery: Knex.QueryBuilder,
    searchQuery: Knex.QueryBuilder,
  } {
    log.debug(`buildBasicQuery is not implemented ${knex.constructor.name}`);
    throw new Error('buildBasicQuery is not implemented');
  }

  protected buildTermQuery(queries: {
    countQuery: Knex.QueryBuilder,
    searchQuery: Knex.QueryBuilder,
    dbQueryParameters?: DbQueryParameters,
  }) {
    const table = typeToTable[this.type];
    const { countQuery, searchQuery, dbQueryParameters } = queries;
    const { termFields = {} } = dbQueryParameters || this.dbQueryParameters;

    Object.entries(termFields).forEach(([name, value]) => {
      countQuery.where(`${table}.${name}`, value);
      searchQuery.where(`${table}.${name}`, value);
    });
  }

  protected buildInfixPrefixQuery(params: {
    countQuery: Knex.QueryBuilder,
    searchQuery: Knex.QueryBuilder,
    dbQueryParameters?: DbQueryParameters,
  }) {
    log.debug(`buildInfixPrefixQuery is not implemented ${Object.keys(params)}`);
    throw new Error('buildInfixPrefixQuery is not implemented');
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
   * build and execute search query
   *
   * @param testKnex - knex for testing
   * @returns search result
   */
  async query(testKnex: Knex | undefined) {
    const knex = testKnex ?? await getKnexClient();
    const { countQuery, searchQuery } = this._buildSearch(knex);
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
