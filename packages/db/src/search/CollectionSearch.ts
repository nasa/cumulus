import { Knex } from 'knex';
import pick from 'lodash/pick';

import Logger from '@cumulus/logger';
import { CollectionRecord } from '@cumulus/types/api/collections';
import { GranuleStatus } from '@cumulus/types/api/granules';
import { BaseSearch } from './BaseSearch';
import { TableNames } from '../tables';
import { DbQueryParameters, QueryEvent } from '../types/search';
import { translatePostgresCollectionToApiCollection } from '../translate/collections';
import { PostgresCollectionRecord } from '../types/collection';

const log = new Logger({ sender: '@cumulus/db/CollectionSearch' });

/**
 * There is no need to declare an ApiCollectionRecord type since
 * CollectionRecord contains all the same fields from the api
 */

/**
 * Class to build and execute db search query for collection
 */
export class CollectionSearch extends BaseSearch {
  readonly active: boolean;
  constructor(event: QueryEvent) {
    const { active, ...queryStringParameters } = event.queryStringParameters || {};
    super({ queryStringParameters }, 'collection');
    this.active = (active === 'true');
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
      [countQuery, searchQuery].forEach((query) => query.whereLike(`${this.tableName}.name`, `%${infix}%`));
    }
    if (prefix) {
      [countQuery, searchQuery].forEach((query) => query.whereLike(`${this.tableName}.name`, `%${prefix}%`));
    }
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
    knex: Knex,
    countQuery: Knex.QueryBuilder,
    searchQuery: Knex.QueryBuilder,
    dbQueryParameters?: DbQueryParameters,
  }) {
    if (!this.active) super.buildRangeQuery(params);

    const granulesTable = TableNames.granules;
    const { knex, countQuery, searchQuery, dbQueryParameters } = params;
    const { range = {} } = dbQueryParameters ?? this.dbQueryParameters;

    const subQuery = knex.select(1).from(granulesTable)
      .join(`${this.tableName}`, `${granulesTable}.collection_cumulus_id`, `${this.tableName}.cumulus_id`);

    Object.entries(range).forEach(([name, rangeValues]) => {
      if (rangeValues.gte) {
        subQuery.where(`${granulesTable}.${name}`, '>=', rangeValues.gte);
      }
      if (rangeValues.lte) {
        subQuery.where(`${granulesTable}.${name}`, '<=', rangeValues.lte);
      }
    });

    if (Object.keys(range).length > 0) {
      [countQuery, searchQuery].forEach((query) => query.whereExists(subQuery));
    }
  }

  /**
   * Translate postgres records to api records
   *
   * @param pgRecords - postgres records returned from query
   * @returns translated api records
   */
  protected translatePostgresRecordsToApiRecords(pgRecords: PostgresCollectionRecord[])
    : Partial<CollectionRecord>[] {
    log.debug(`translatePostgresRecordsToApiRecords number of records ${pgRecords.length} `);
    const apiRecords = pgRecords.map((item) => {
      const apiRecord = translatePostgresCollectionToApiCollection(item);

      return this.dbQueryParameters.fields
        ? pick(apiRecord, this.dbQueryParameters.fields)
        : apiRecord;
    });
    return apiRecords;
  }
}
