import { Knex } from 'knex';
import pick from 'lodash/pick';
import { DuckDBConnection } from '@duckdb/node-api';

import { ApiGranuleRecord } from '@cumulus/types/api/granules';
import Logger from '@cumulus/logger';

import {
  getExecutionInfoByGranuleCumulusIds,
  getFilesByGranuleCumulusIds,
} from './duckdbHelpers';
import { executeDuckDBSearch } from './DuckDBSearchExecutor';
import { GranuleRecord, GranuleSearch } from '../search/GranuleSearch';
import { QueryEvent } from '../types/search';
import { translatePostgresGranuleToApiGranuleWithoutDbQuery } from '../translate/granules';
import { PostgresFileRecord } from '../types/file';

const log = new Logger({ sender: '@cumulus/db/GranuleIcebergSearch' });

/**
 * Class to build and execute DuckDB search query for granules
 */
export class GranuleIcebergSearch extends GranuleSearch {
  private readonly dbConnection: DuckDBConnection | undefined;

  constructor(event: QueryEvent, dbConnection?: DuckDBConnection) {
    super(event, false); // disables estimateTableRowCount
    this.dbConnection = dbConnection;
  }

  /**
   * Translate postgres records to api records
   *
   * @param pgRecords - postgres records returned from query
   * @param knexClient - DB client
   * @returns translated api records
   */
  private async translateRecords(
    pgRecords: GranuleRecord[],
    knexClient: Knex,
    dbConnection: DuckDBConnection
  ): Promise<Partial<ApiGranuleRecord>[]> {
    log.debug(`translatePostgresRecordsToApiRecords number of records ${pgRecords.length} `);

    const { fields, includeFullRecord } = this.dbQueryParameters;

    const fileMapping: { [key: number]: PostgresFileRecord[] } = {};
    const executionMapping: { [key: number]: { url: string, granule_cumulus_id: number } } = {};
    const cumulusIds = pgRecords.map((record) => record.cumulus_id);
    if (includeFullRecord) {
      //get files
      const files = await getFilesByGranuleCumulusIds({
        connection: dbConnection,
        granuleCumulusIds: cumulusIds,
        knexBuilder: knexClient,
      });
      files.forEach((file) => {
        if (!(file.granule_cumulus_id in fileMapping)) {
          fileMapping[file.granule_cumulus_id] = [];
        }
        fileMapping[file.granule_cumulus_id].push(file);
      });

      //get Executions
      const executions = await getExecutionInfoByGranuleCumulusIds({
        connection: dbConnection,
        granuleCumulusIds: cumulusIds,
        knexBuilder: knexClient,
      });
      executions.forEach((execution) => {
        if (!(execution.granule_cumulus_id in executionMapping)) {
          executionMapping[execution.granule_cumulus_id] = execution;
        }
      });
    }
    const apiRecords = pgRecords.map((item: GranuleRecord) => {
      const collectionPgRecord = {
        cumulus_id: item.collection_cumulus_id,
        name: item.collectionName,
        version: item.collectionVersion,
      };
      const executionUrls = executionMapping[item.cumulus_id]?.url
        ? [{ url: executionMapping[item.cumulus_id].url }]
        : [];
      const pdr = item.pdrName ? { name: item.pdrName } : undefined;
      const providerPgRecord = item.providerName ? { name: item.providerName } : undefined;
      const fileRecords = fileMapping[item.cumulus_id] || [];
      const apiRecord = translatePostgresGranuleToApiGranuleWithoutDbQuery({
        granulePgRecord: item,
        collectionPgRecord,
        pdr,
        providerPgRecord,
        files: fileRecords,
        executionUrls,
      });

      return fields ? pick(apiRecord, fields) : apiRecord;
    });
    return apiRecords;
  }

  /**
   * Build and execute search query.
   * Uses the connection supplied at construction time (e.g. in tests), or
   * borrows one from the pool and releases it when done.
   *
   * @returns search result
   */
  async query() {
    return executeDuckDBSearch({
      injectedConnection: this.dbConnection,
      dbQueryParameters: this.dbQueryParameters,
      getMetaTemplate: this._metaTemplate.bind(this),
      makeTranslateRecords: (conn) => (records, knexClient) =>
        this.translateRecords(records, knexClient, conn),
      buildSearch: (knexBuilder) => this.buildSearch(knexBuilder),
    });
  }
}
