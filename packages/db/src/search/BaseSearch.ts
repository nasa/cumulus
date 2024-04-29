import { Knex } from 'knex';
import Logger from '@cumulus/logger';
import { getKnexClient } from '../connection';
import { BaseRecord } from '../types/base';
import { ParsedQueryParameters, QueryEvent, QueryStringParameters } from '../types/search';

const log = new Logger({ sender: '@cumulus/db/BaseSearch' });

export interface Meta {
  name: string,
  stack?: string,
  table?: string,
  limit?: number,
  page?: number,
  count?: number,
}

/**
 * Class to build and execute db search query
 */
class BaseSearch {
  readonly type?: string;
  readonly queryStringParameters: QueryStringParameters;
  // parsed from queryStringParameters
  parsedQueryParameters: ParsedQueryParameters = {};

  constructor(event: QueryEvent, type?: string) {
    this.type = type;
    this.queryStringParameters = event?.queryStringParameters ?? {};
    this.parsedQueryParameters.page = Number.parseInt(
      (this.queryStringParameters.page) ?? '1',
      10
    );
    this.parsedQueryParameters.limit = Number.parseInt(
      (this.queryStringParameters.limit) ?? '10',
      10
    );
    this.parsedQueryParameters.offset = (this.parsedQueryParameters.page - 1)
      * this.parsedQueryParameters.limit;
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
    const updatedQuery = searchQuery.modify((queryBuilder) => {
      if (this.parsedQueryParameters.limit) queryBuilder.limit(this.parsedQueryParameters.limit);
      if (this.parsedQueryParameters.offset) queryBuilder.offset(this.parsedQueryParameters.offset);
    });
    return { countQuery, searchQuery: updatedQuery };
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
      table: this.type,
    };
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
      meta.limit = this.parsedQueryParameters.limit;
      meta.page = this.parsedQueryParameters.page;
      meta.count = Number(countResult[0]?.count ?? 0);

      const pgRecords = await searchQuery;
      const apiRecords = this.translatePostgresRecordsToApiRecords(pgRecords);

      return {
        meta,
        results: apiRecords,
      };
    } catch (error) {
      return error;
    }
  }
}

export { BaseSearch };
