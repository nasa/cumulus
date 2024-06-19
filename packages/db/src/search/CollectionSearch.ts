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

interface Statuses {
  queued: number;
  completed: number;
  failed: number;
  running: number;
  total: number;
}

interface StatsRecord {
  id: string | number,
  statuses: Statuses;
}

interface QueryCollectionRecord extends BaseRecord, PostgresCollectionRecord {
  statuses?: Array<string>,
}

type IncludeStatsRecord = Record<string, StatsRecord>;

/**
 * Class to build and execute db search query for collection
 */
export class CollectionSearch extends BaseSearch {
  readonly includeStats: boolean;

  constructor(event: QueryEvent) {
    super(event, 'collection');
    this.includeStats = (this.queryStringParameters?.includeStats === 'true');
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
   * Helper function to translate all postgres records to api records, along with includeStats
   *
   * @param pgRecords - postgres records returned from query
   * @returns translated api records
   */
  protected translateAllPostgresRecordsToApiRecords(pgRecords: QueryCollectionRecord[],
    stats?: IncludeStatsRecord): Partial<CollectionRecord>[] {
    const apiRecords = pgRecords.map((record) => {
      const apiRecord = translatePostgresCollectionToApiCollection(record);
      const apiRecordFinal = this.dbQueryParameters.fields
        ? pick(apiRecord, this.dbQueryParameters.fields)
        : apiRecord;

      if (stats) {
        apiRecordFinal.stats = stats[record.cumulus_id] ? stats[record.cumulus_id].statuses : {
          queued: 0,
          completed: 0,
          failed: 0,
          running: 0,
          total: 0,
        };
      }
      return apiRecordFinal;
    });
    return apiRecords;
  }

  /**
   * Translate postgres records to api records
   *
   * @param pgRecords - postgres records returned from query
   * @returns translated api records
   */
  protected async translatePostgresRecordsToApiRecords(pgRecords: QueryCollectionRecord[],
    knex: Knex): Promise<Partial<CollectionRecord>[]> {
    log.debug(`translatePostgresRecordsToApiRecords number of records ${pgRecords.length} `);
    if (this.includeStats) {
      const cumulusIds = pgRecords.map((record) => record.cumulus_id);
      const granulesTable = TableNames.granules;
      const statsQuery = knex(granulesTable)
        .select(`${granulesTable}.collection_cumulus_id`, `${granulesTable}.status`)
        .count(`${granulesTable}.status`)
        .groupBy(`${granulesTable}.collection_cumulus_id`, `${granulesTable}.status`)
        .whereIn(`${granulesTable}.collection_cumulus_id`, cumulusIds);
      const results = await statsQuery;
      const reduced = results.reduce((acc, record) => {
        const cumulusId = record.collection_cumulus_id;
        if (!acc[cumulusId]) {
          acc[cumulusId] = {
            id: cumulusId,
            statuses: {
              queued: 0,
              completed: 0,
              failed: 0,
              running: 0,
              total: 0,
            },
          };
        }
        acc[cumulusId].statuses[record.status as keyof Statuses] += Number(record.count);
        acc[cumulusId].statuses['total'] += Number(record.count);
        return acc;
      }, {} as IncludeStatsRecord);
      return this.translateAllPostgresRecordsToApiRecords(pgRecords, reduced);
    }
    return this.translateAllPostgresRecordsToApiRecords(pgRecords);
  }
}
