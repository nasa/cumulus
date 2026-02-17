import { Knex } from 'knex';
import pick from 'lodash/pick';
import { DuckDBConnection } from '@duckdb/node-api';

import Logger from '@cumulus/logger';

import { CollectionSearch, Statuses, StatsRecords, CollectionRecordApi } from '../search/CollectionSearch';
import { TableNames } from '../tables';
import { translatePostgresCollectionToApiCollection } from '../translate/collections';
import { PostgresCollectionRecord } from '../types/collection';
import { QueryEvent } from '../types/search';
import { prepareBindings } from './duckdbHelpers';
import { GranuleS3Search } from './GranuleS3Search';
import { DuckDBSearchExecutor } from './DuckDBSearchExecutor';

const log = new Logger({ sender: '@cumulus/db/CollectionS3Search' });

/**
 * Class to build and execute db search query for collections
 */
export class CollectionS3Search extends CollectionSearch {
  private dbConnection: DuckDBConnection;
  //private knexBuilder: Knex;
  private duckDBSearchExecutor: DuckDBSearchExecutor;

  constructor(event: QueryEvent, dbConnection: DuckDBConnection) {
    super(event);
    this.dbConnection = dbConnection;
    // Use 'pg' dialect to generate DuckDB-compatible SQL ($1, $2, etc.)
    //this.knexBuilder = knex({ client: 'pg' });
    this.duckDBSearchExecutor = new DuckDBSearchExecutor({
      dbConnection,
      dbQueryParameters: this.dbQueryParameters,
      getMetaTemplate: this._metaTemplate.bind(this),
      translateRecords: this.translatePostgresRecordsToApiRecords.bind(this),
    });
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
      const granuleS3Search = new GranuleS3Search(
        { queryStringParameters: this.queryStringParameters },
        this.dbConnection
      );
      const { countQuery } = granuleS3Search.buildSearchForActiveCollections(knexClient);
      statsQuery = countQuery.clear('select');
    }

    statsQuery
      .select(`${granulesTable}.collection_cumulus_id`, `${granulesTable}.status`)
      .count('* as count')
      .groupBy(`${granulesTable}.collection_cumulus_id`, `${granulesTable}.status`)
      .whereIn(`${granulesTable}.collection_cumulus_id`, collectionCumulusIds);

    log.debug(`retrieveGranuleStats statsQuery: ${statsQuery?.toSQL().sql}`);
    const { sql, bindings } = statsQuery.toSQL().toNative();
    const reader = await this.dbConnection.runAndReadAll(
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
    return this.duckDBSearchExecutor.query((knexBuilder) =>
      this.buildSearch(knexBuilder));
  }
}
