import { Knex } from 'knex';
import omitBy from 'lodash/omitBy';
import pick from 'lodash/pick';

import Logger from '@cumulus/logger';
import { CollectionRecord } from '@cumulus/types/api/collections';
import { BaseSearch } from './BaseSearch';
import { convertQueryStringToDbQueryParameters } from './queries';
import { GranuleSearch } from './GranuleSearch';
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

const granuleFields = ['createdAt', 'granuleId', 'timestamp', 'updatedAt'];
const isGranuleField = (_value: any, key: string): boolean =>
  granuleFields.includes(key.split('__')[0]);

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

    // for active collection search, omit the fields which are for searching granules
    if (this.active) {
      this.dbQueryParameters = convertQueryStringToDbQueryParameters(
        this.type, omitBy(this.queryStringParameters, isGranuleField)
      );
    }
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
      [countQuery, searchQuery].forEach((query) => query.whereLike(`${this.tableName}.name`, `${prefix}%`));
    }
  }

  /**
   * Build subquery for active collections
   * The subquery will search granules
   *
   * @param knex - db client
   * @returns granule query
   */
  private buildSubQueryForActiveCollections(knex: Knex): Knex.QueryBuilder {
    const granulesTable = TableNames.granules;
    const granuleSearch = new GranuleSearch({ queryStringParameters: this.queryStringParameters });
    const { countQuery: subQuery } = granuleSearch.buildSearchForActiveCollections(knex);

    subQuery
      .clear('select')
      .select(1)
      .where(`${granulesTable}.collection_cumulus_id`, knex.raw(`${this.tableName}.cumulus_id`))
      .limit(1);
    return subQuery;
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
    const queries = super.buildSearch(knex);
    if (!this.active) {
      return queries;
    }

    const subQuery = this.buildSubQueryForActiveCollections(knex);
    const { countQuery, searchQuery } = queries;
    [countQuery, searchQuery].forEach((query) => query?.whereExists(subQuery));

    log.debug(`buildSearch returns countQuery: ${countQuery?.toSQL().sql}, searchQuery: ${searchQuery.toSQL().sql}`);
    return { countQuery, searchQuery };
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
    let statsQuery = knex(granulesTable);

    if (this.active) {
      const granuleSearch = new GranuleSearch({
        queryStringParameters: this.queryStringParameters,
      });
      const { countQuery } = granuleSearch.buildSearchForActiveCollections(knex);
      statsQuery = countQuery.clear('select');
    }

    statsQuery
      .select(`${granulesTable}.collection_cumulus_id`, `${granulesTable}.status`)
      .count('*')
      .groupBy(`${granulesTable}.collection_cumulus_id`, `${granulesTable}.status`)
      .whereIn(`${granulesTable}.collection_cumulus_id`, collectionCumulusIds);

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

    const { fields } = this.dbQueryParameters;
    let statsRecords: StatsRecords;
    const cumulusIds = pgRecords.map((record) => record.cumulus_id);
    if (this.includeStats) {
      statsRecords = await this.retrieveGranuleStats(cumulusIds, knex);
    }

    const apiRecords = pgRecords.map((record) => {
      const apiRecord: CollectionRecordApi = translatePostgresCollectionToApiCollection(record);
      const apiRecordFinal = fields ? pick(apiRecord, fields) : apiRecord;

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
