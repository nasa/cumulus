import { Knex } from 'knex';
import omitBy from 'lodash/omitBy';
import pick from 'lodash/pick';

import Logger from '@cumulus/logger';
import { CollectionRecord } from '@cumulus/types/api/collections';

// Import OpenTelemetry
import { trace } from '@opentelemetry/api';

import { BaseSearch } from './BaseSearch';
import { convertQueryStringToDbQueryParameters } from './queries';
import { GranuleSearch } from './GranuleSearch';
import { DbQueryParameters, QueryEvent } from '../types/search';
import { translatePostgresCollectionToApiCollection } from '../translate/collections';
import { PostgresCollectionRecord } from '../types/collection';
import { TableNames } from '../tables';

const log = new Logger({ sender: '@cumulus/db/CollectionSearch' });

// Get the tracer
const tracer = trace.getTracer('cumulus-db');

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
    return tracer.startActiveSpan('CollectionSearch.buildInfixPrefixQuery', (span) => {
      try {
        const { countQuery, searchQuery, dbQueryParameters } = params;
        const { infix, prefix } = dbQueryParameters ?? this.dbQueryParameters;

        if (infix) {
          span.setAttribute('query.has_infix', true);
          span.setAttribute('query.infix_length', infix.length);
          [countQuery, searchQuery].forEach((query) => query.whereLike(`${this.tableName}.name`, `%${infix}%`));
        }
        if (prefix) {
          span.setAttribute('query.has_prefix', true);
          span.setAttribute('query.prefix_length', prefix.length);
          [countQuery, searchQuery].forEach((query) => query.whereLike(`${this.tableName}.name`, `${prefix}%`));
        }
      } finally {
        span.end();
      }
    });
  }

  /**
   * Build subquery for active collections
   * The subquery will search granules
   *
   * @param knex - db client
   * @returns granule query
   */
  private buildSubQueryForActiveCollections(knex: Knex): Knex.QueryBuilder {
    return tracer.startActiveSpan('CollectionSearch.buildSubQueryForActiveCollections', (span) => {
      try {
        const granulesTable = TableNames.granules;
        span.setAttribute('db.granules_table', granulesTable);

        const granuleSearch = new GranuleSearch({ queryStringParameters: this.queryStringParameters });
        const { countQuery: subQuery } = granuleSearch.buildSearchForActiveCollections(knex);

        subQuery
          .clear('select')
          .select(1)
          .where(`${granulesTable}.collection_cumulus_id`, knex.raw(`${this.tableName}.cumulus_id`))
          .limit(1);

        const subQuerySql = subQuery.toSQL().sql;
        span.setAttribute('db.subquery', subQuerySql);

        return subQuery;
      } finally {
        span.end();
      }
    });
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
    return tracer.startActiveSpan('CollectionSearch.buildSearch', (span) => {
      try {
        span.setAttribute('collection.active', this.active);
        span.setAttribute('collection.include_stats', this.includeStats);

        const queries = super.buildSearch(knex);
        if (!this.active) {
          span.setAttribute('query.type', 'all_collections');
          return queries;
        }

        span.setAttribute('query.type', 'active_collections');

        const subQuery = this.buildSubQueryForActiveCollections(knex);
        const { countQuery, searchQuery } = queries;
        [countQuery, searchQuery].forEach((query) => query?.whereExists(subQuery));

        const countSql = countQuery?.toSQL().sql;
        const searchSql = searchQuery.toSQL().sql;

        span.setAttribute('db.count_query', countSql || 'none');
        span.setAttribute('db.search_query', searchSql);

        log.debug(`buildSearch returns countQuery: ${countSql}, searchQuery: ${searchSql}`);
        return { countQuery, searchQuery };
      } finally {
        span.end();
      }
    });
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
    return tracer.startActiveSpan('CollectionSearch.retrieveGranuleStats', async (span) => {
      try {
        const granulesTable = TableNames.granules;
        span.setAttribute('db.table', granulesTable);
        span.setAttribute('collection.count', collectionCumulusIds.length);
        span.setAttribute('query.active', this.active);

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

        const statsQuerySql = statsQuery?.toSQL().sql;
        span.setAttribute('db.stats_query', statsQuerySql);

        log.debug(`retrieveGranuleStats statsQuery: ${statsQuerySql}`);

        const queryStartTime = Date.now();
        const results = await statsQuery;
        const queryDuration = Date.now() - queryStartTime;

        span.setAttribute('db.query_duration_ms', queryDuration);
        span.setAttribute('db.results_count', results.length);

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

        span.setAttribute('stats.collections_with_granules', Object.keys(reduced).length);

        return reduced;
      } catch (error) {
        span.recordException(error as Error);
        span.setAttribute('error', true);
        throw error;
      } finally {
        span.end();
      }
    });
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
    return tracer.startActiveSpan('CollectionSearch.translatePostgresRecordsToApiRecords', async (span) => {
      try {
        const recordCount = pgRecords.length;
        span.setAttribute('db.record_count', recordCount);
        span.setAttribute('collection.include_stats', this.includeStats);

        log.debug(`translatePostgresRecordsToApiRecords number of records ${recordCount}`);

        const { fields } = this.dbQueryParameters;
        span.setAttribute('query.has_field_filter', !!fields);

        let statsRecords: StatsRecords;
        const cumulusIds = pgRecords.map((record) => record.cumulus_id);

        if (this.includeStats) {
          statsRecords = await this.retrieveGranuleStats(cumulusIds, knex);
        }

        const translationStartTime = Date.now();
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
        const translationDuration = Date.now() - translationStartTime;

        span.setAttribute('translation.duration_ms', translationDuration);
        span.setAttribute('translation.records_count', apiRecords.length);

        return apiRecords;
      } catch (error) {
        span.recordException(error as Error);
        span.setAttribute('error', true);
        throw error;
      } finally {
        span.end();
      }
    });
  }
}