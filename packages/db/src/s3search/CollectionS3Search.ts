import { knex, Knex } from 'knex';
//import omitBy from 'lodash/omitBy';
import pick from 'lodash/pick';
import { DuckDBConnection } from '@duckdb/node-api';

import Logger from '@cumulus/logger';
//import { CollectionRecord } from '@cumulus/types/api/collections';
import { CollectionSearch, Statuses, StatsRecords, CollectionRecordApi } from '../search/CollectionSearch';
//import { convertQueryStringToDbQueryParameters } from '../search/queries';
import { GranuleSearch } from '../search/GranuleSearch';
import { QueryEvent } from '../types/search';
import { translatePostgresCollectionToApiCollection } from '../translate/collections';
import { PostgresCollectionRecord } from '../types/collection';
import { TableNames } from '../tables';
import { prepareBindings } from './duckdbHelpers';

const log = new Logger({ sender: '@cumulus/db/CollectionS3Search' });

/**
 * Class to build and execute db search query for collections
 */
export class CollectionS3Search extends CollectionSearch {
  private duckDbConn: DuckDBConnection;
  private knexBuilder: Knex;

  constructor(event: QueryEvent, duckDbConn: DuckDBConnection) {
    super(event);
    this.duckDbConn = duckDbConn;
    // Use 'pg' dialect to generate DuckDB-compatible SQL ($1, $2, etc.)
    this.knexBuilder = knex({ client: 'pg' });
  }

  /**
   * Executes stats query to get granules' status aggregation
   *
   * @param collectionCumulusIds - array of cumulusIds of the collections
   * @param knexClient - knex for the stats query
   * @returns the collection's granules status' aggregation
   */
  protected async retrieveGranuleStats(collectionCumulusIds: number[], knexClient: Knex)
    : Promise<StatsRecords> {
    const granulesTable = TableNames.granules;
    let statsQuery = knexClient(granulesTable);

    if (this.active) {
      const granuleSearch = new GranuleSearch({
        queryStringParameters: this.queryStringParameters,
      });
      const { countQuery } = granuleSearch.buildSearchForActiveCollections(knexClient);
      statsQuery = countQuery.clear('select');
    }

    statsQuery
      .select(`${granulesTable}.collection_cumulus_id`, `${granulesTable}.status`)
      .count('* as count')
      .groupBy(`${granulesTable}.collection_cumulus_id`, `${granulesTable}.status`)
      .whereIn(`${granulesTable}.collection_cumulus_id`, collectionCumulusIds);

    log.debug(`retrieveGranuleStats statsQuery: ${statsQuery?.toSQL().sql}`);
    const { sql, bindings } = statsQuery.toSQL().toNative();
    const reader = await this.duckDbConn.runAndReadAll(
      sql,
      prepareBindings(bindings)
    );
    const results = reader.getRowObjectsJson();
    const reduced = results.reduce((acc: Record<number, Statuses>, record) => {
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
   * @param knexClient - knex for the stats query if incldueStats is true
   * @returns translated api records
   */
  protected async translatePostgresRecordsToApiRecords(pgRecords: PostgresCollectionRecord[],
    knexClient: Knex): Promise<Partial<CollectionRecordApi>[]> {
    log.debug(`translatePostgresRecordsToApiRecords number of records ${pgRecords.length} `);

    const { fields } = this.dbQueryParameters;
    let statsRecords: StatsRecords;
    const cumulusIds = pgRecords.map((record) => record.cumulus_id);
    if (this.includeStats) {
      statsRecords = await this.retrieveGranuleStats(cumulusIds, knexClient);
    }

    const apiRecords = pgRecords.map((record) => {
      const parsedRecord = {
        ...record,
        created_at: new Date(record.created_at),
        updated_at: new Date(record.updated_at),
      };

      const apiRecord: CollectionRecordApi = translatePostgresCollectionToApiCollection(
        parsedRecord
      );
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

  /**
   * Build and execute search query
   *
   * @returns search result
   */
  async query() {
    const { countQuery, searchQuery } = this.buildSearch(this.knexBuilder);

    const shouldReturnCountOnly = this.dbQueryParameters.countOnly === true;

    try {
      const queryConfigs = [
        { key: 'count', query: countQuery },
        ...(!shouldReturnCountOnly ? [{ key: 'records', query: searchQuery }] : []),
      ];

      const executionPromises = queryConfigs.map(async (config) => {
        if (!config.query) return [];

        const { sql, bindings } = config.query.toSQL().toNative();

        const reader = await this.duckDbConn.runAndReadAll(
          sql,
          prepareBindings(bindings)
        );

        return reader.getRowObjectsJson();
      });

      const [countResult, pgRecords] = await Promise.all(executionPromises);
      console.log('countResult', countResult);
      console.log('pgRecords', pgRecords);

      const meta = this._metaTemplate();
      meta.limit = this.dbQueryParameters.limit;
      meta.page = this.dbQueryParameters.page;
      meta.count = Number(countResult[0]?.count ?? 0);

      const apiRecords = await this.translatePostgresRecordsToApiRecords(
        pgRecords as unknown as PostgresCollectionRecord[], this.knexBuilder
      );

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
