import { Knex } from 'knex';
import pick from 'lodash/pick';

import Logger from '@cumulus/logger';
import { CollectionRecord } from '@cumulus/types/api/collections';
import { BaseSearch } from './BaseSearch';
import { DbQueryParameters, QueryEvent } from '../types/search';
import { translatePostgresCollectionToApiCollection } from '../translate/collections';
import { PostgresCollectionRecord } from '../types/collection';
import { TableNames } from '../tables';
import { BaseRecord } from '../types/base';

const log = new Logger({ sender: '@cumulus/db/CollectionSearch' });

type StatusTypes = 'running' | 'queued' | 'completed' | 'failed' | 'total';
type IncludeStats = {
  [Status in StatusTypes]: number
};

interface QueryCollectionRecord extends BaseRecord, PostgresCollectionRecord {
  statuses?: Array<string>,
}

/**
 * Class to build and execute db search query for collection
 */
export class CollectionSearch extends BaseSearch {
  constructor(event: QueryEvent) {
    super(event, 'collection');
  }

  /**
   * check if joined granules table search is needed
   *
   * @returns whether includeStats is needed
   */
  protected searchIncludeStats(): boolean {
    const includeStats = this.queryStringParameters?.includeStats;
    return includeStats === 'true' || includeStats === true;
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
    const {
      granules: granulesTable,
    } = TableNames;
    const countQuery = knex(this.tableName)
      .count(`${this.tableName}.cumulus_id`);

    const searchQuery = knex(this.tableName)
      .select(`${this.tableName}.*`);

    if (this.searchIncludeStats()) {
      searchQuery.join(`${granulesTable}`, `${this.tableName}.cumulus_id`, `${granulesTable}.collection_cumulus_id`)
        .select(`${this.tableName}.*`, knex.raw(`ARRAY_AGG(${granulesTable}.status) AS statuses`)).groupBy(`${this.tableName}.cumulus_id`);
    }
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
   * Translate postgres records to api records
   *
   * @param pgRecords - postgres records returned from query
   * @returns translated api records
   */
  protected translatePostgresRecordsToApiRecords(pgRecords: QueryCollectionRecord[])
    : Partial<CollectionRecord>[] {
    log.debug(`translatePostgresRecordsToApiRecords number of records ${pgRecords.length} `);
    const apiRecords = pgRecords.map((item) => {
      const apiRecord = translatePostgresCollectionToApiCollection(item);
      if (this.searchIncludeStats()) {
        const Statuses: IncludeStats = { failed: 0, queued: 0, running: 0, completed: 0, total: 0 };
        item.statuses?.forEach((key) => {
          if (key in Statuses) {
            Statuses[key as StatusTypes] += 1;
            Statuses['total'] += 1;
          }
        });
        apiRecord.stats = Statuses;
      }

      return this.dbQueryParameters.fields
        ? pick(apiRecord, this.dbQueryParameters.fields)
        : apiRecord;
    });
    return apiRecords;
  }
}
