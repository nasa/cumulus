import { Knex } from 'knex';
import Logger from '@cumulus/logger';
import { CollectionRecord } from '@cumulus/types/api/collections';
import { BaseSearch } from './BaseSearch';
import { DbQueryParameters, QueryEvent } from '../types/search';
import { PostgresCollectionRecord } from '../types/collection';
import { translatePostgresCollectionToApiCollection } from '../translate/collections';
import { BaseRecord } from '../types/base';

const log = new Logger({ sender: '@cumulus/db/GranuleSearch' });

interface ApiCollectionRecord extends BaseRecord, PostgresCollectionRecord {
  createdAt?: number,
  updatedAt?: number,
  name: string,
  version: string,
  process?: string,
  duplicateHandling?: string,
  granuleId?: string,
  granuleIdExtraction?: string,
  files: string,
  reportToEms?: string,
  sampleFileName?: string,
  stats?: object,
}

/**
 * Class to build and execute db search query for collection
 */
export class CollectionSearch extends BaseSearch {
  constructor(event: QueryEvent) {
    super(event, 'collection');
  }

  /**
   * Build basic query
   *
   * @param knex - DB client
   * @returns queries for getting count and search result
   */
  protected buildBasicQuery(knex: Knex)
    : {
      countQuery: Knex.QueryBuilder,
      searchQuery: Knex.QueryBuilder,
    } {
    const countQuery = knex(this.tableName)
      .count(`${this.tableName}.cumulus_id`);

    const searchQuery = knex(this.tableName)
      .select(`${this.tableName}.*`);
    return { countQuery, searchQuery };
  }

  /**
   * Build queries for infix and prefix
   *
   * @param params
   * @param params.countQuery - query builder for getting count
   * @param params.searchQuery - query builder for search
   * @param [params.dbQueryParameters] - db query parameters
   */
  protected buildInfixPrefixQuery(params: {
    countQuery: Knex.QueryBuilder,
    searchQuery: Knex.QueryBuilder,
    dbQueryParameters?: DbQueryParameters,
  }) {
    const { countQuery, searchQuery, dbQueryParameters } = params;
    const { infix, prefix } = dbQueryParameters ?? this.dbQueryParameters;
    if (infix) {
      countQuery.whereLike(`${this.tableName}.name`, `%${infix}%`);
      searchQuery.whereLike(`${this.tableName}.name`, `%${infix}%`);
    }
    if (prefix) {
      countQuery.whereLike(`${this.tableName}.name`, `${prefix}%`);
      searchQuery.whereLike(`${this.tableName}.name`, `${prefix}%`);
    }
  }

  /**
   * Translate postgres records to api records
   *
   * @param pgRecords - postgres records returned from query
   * @returns translated api records
   */
  protected translatePostgresRecordsToApiRecords(pgRecords: ApiCollectionRecord[])
    : Partial<CollectionRecord[]> {
    log.debug(`translatePostgresRecordsToApiRecords number of records ${pgRecords.length} `);
    const apiRecords = pgRecords.map((item: ApiCollectionRecord) =>
      translatePostgresCollectionToApiCollection(item));
    return apiRecords;
  }
}
