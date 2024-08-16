import { Knex } from 'knex';
import pick from 'lodash/pick';

import Logger from '@cumulus/logger';
import { CollectionRecord } from '@cumulus/types/api/collections';
import { BaseSearch } from './BaseSearch';
import { DbQueryParameters, QueryEvent } from '../types/search';
import { translatePostgresCollectionToApiCollection } from '../translate/collections';
import { PostgresCollectionRecord } from '../types/collection';
import { TableNames } from '../tables';

const log = new Logger({ sender: '@cumulus/db/CollectionSearch' });

type Statuses = {
  queued: number,
  completed: number,
  failed: number,
  running: number,
  total: number,
};

type StatsRecords = {
  [key: number]: Statuses,
};

interface CollectionRecordApi extends CollectionRecord {
  stats?: Statuses,
}

/**
 * Class to build and execute db search query for collections
 */
export class CollectionSearch extends BaseSearch {
  readonly active: boolean;
  readonly includeStats: boolean;

  constructor(event: QueryEvent) {
    const { active, includeStats, ...queryStringParameters } = event.queryStringParameters || {};
    super({ queryStringParameters }, 'collection');
    this.active = (active === 'true');
    this.includeStats = (includeStats === 'true');
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
    if (!this.active) {
      super.buildRangeQuery(params);
      return;
    }

    const granulesTable = TableNames.granules;
    const { knex, countQuery, searchQuery, dbQueryParameters } = params;
    const { range = {} } = dbQueryParameters ?? this.dbQueryParameters;

    const subQuery = knex.select(1).from(granulesTable)
      .where(`${granulesTable}.collection_cumulus_id`, knex.raw(`${this.tableName}.cumulus_id`));

    Object.entries(range).forEach(([name, rangeValues]) => {
      if (rangeValues.gte) {
        subQuery.where(`${granulesTable}.${name}`, '>=', rangeValues.gte);
      }
      if (rangeValues.lte) {
        subQuery.where(`${granulesTable}.${name}`, '<=', rangeValues.lte);
      }
    });
    subQuery.limit(1);

    [countQuery, searchQuery].forEach((query) => query.whereExists(subQuery));
  }

  /**
   * Executes stats query to get granules' status aggregation
   *
   * @param collectionCumulusIds - array of cumulusIds of the collections
   * @param knex - knex for the stats query
   * @returns the collection's granules status' aggregation
   */
  private async retrieveGranuleStats(collectionCumulusIds: number[], knex: Knex)
    : Promise<StatsRecords> {
    const granulesTable = TableNames.granules;
    const statsQuery = knex(granulesTable)
      .select(`${granulesTable}.collection_cumulus_id`, `${granulesTable}.status`)
      .count('*')
      .groupBy(`${granulesTable}.collection_cumulus_id`, `${granulesTable}.status`)
      .whereIn(`${granulesTable}.collection_cumulus_id`, collectionCumulusIds);

    if (this.active) {
      Object.entries(this.dbQueryParameters?.range ?? {}).forEach(([name, rangeValues]) => {
        if (rangeValues.gte) {
          statsQuery.where(`${granulesTable}.${name}`, '>=', rangeValues.gte);
        }
        if (rangeValues.lte) {
          statsQuery.where(`${granulesTable}.${name}`, '<=', rangeValues.lte);
        }
      });
    }
    log.debug(`retrieveGranuleStats statsQuery: ${statsQuery?.toSQL().sql}`);
    const results = await statsQuery;
    const reduced = results.reduce((acc, record) => {
      const cumulusId = Number(record.collection_cumulus_id);
      if (!acc[cumulusId]) {
        acc[cumulusId] = {
          queued: 0,
          completed: 0,
          failed: 0,
          running: 0,
          total: 0,
        };
      }
      acc[cumulusId][record.status as keyof Statuses] += Number(record.count);
      acc[cumulusId]['total'] += Number(record.count);
      return acc;
    }, {} as StatsRecords);
    return reduced;
  }

  /**
   * Translate postgres records to api records
   *
   * @param pgRecords - postgres Collection records returned from query
   * @param knex - knex for the stats query if incldueStats is true
   * @returns translated api records
   */
  protected async translatePostgresRecordsToApiRecords(pgRecords: PostgresCollectionRecord[],
    knex: Knex): Promise<Partial<CollectionRecordApi>[]> {
    log.debug(`translatePostgresRecordsToApiRecords number of records ${pgRecords.length} `);
    let statsRecords: StatsRecords;
    const cumulusIds = pgRecords.map((record) => record.cumulus_id);
    if (this.includeStats) {
      statsRecords = await this.retrieveGranuleStats(cumulusIds, knex);
    }

    const apiRecords = pgRecords.map((record) => {
      const apiRecord: CollectionRecordApi = translatePostgresCollectionToApiCollection(record);
      const apiRecordFinal = this.dbQueryParameters.fields
        ? pick(apiRecord, this.dbQueryParameters.fields)
        : apiRecord;

      if (statsRecords) {
        apiRecordFinal.stats = statsRecords[record.cumulus_id] ? statsRecords[record.cumulus_id]
          : {
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
}
