import { Knex } from 'knex';
import pick from 'lodash/pick';
import { DuckDBConnection } from '@duckdb/node-api';

import { ApiGranuleRecord } from '@cumulus/types/api/granules';
import { returnNullOrUndefinedOrDate } from '@cumulus/common/util';
import Logger from '@cumulus/logger';

import {
  getExecutionInfoByGranuleCumulusIds,
  getFilesByGranuleCumulusIds,
} from './duckdbHelpers';
import { DuckDBSearchExecutor } from './DuckDBSearchExecutor';
import { GranuleRecord, GranuleSearch } from '../search/GranuleSearch';
import { QueryEvent } from '../types/search';
import { translatePostgresGranuleToApiGranuleWithoutDbQuery } from '../translate/granules';
import { PostgresFileRecord } from '../types/file';

const log = new Logger({ sender: '@cumulus/db/GranuleS3Search' });

/**
 * Class to build and execute db search query for granules
 */
export class GranuleS3Search extends GranuleSearch {
  private dbConnection: DuckDBConnection;
  private duckDBSearchExecutor: DuckDBSearchExecutor;

  constructor(event: QueryEvent, dbConnection: DuckDBConnection) {
    super(event, false); // disables estimateTableRowCount
    this.dbConnection = dbConnection;

    this.duckDBSearchExecutor = new DuckDBSearchExecutor({
      dbConnection,
      dbQueryParameters: this.dbQueryParameters,
      getMetaTemplate: this._metaTemplate.bind(this),
      translateRecords: this.translatePostgresRecordsToApiRecords.bind(this),
    });
  }

  /**
   * Translate postgres records to api records
   *
   * @param pgRecords - postgres records returned from query
   * @param knexClient - DB client
   * @returns translated api records
   */
  protected async translatePostgresRecordsToApiRecords(pgRecords: GranuleRecord[], knexClient: Knex)
    : Promise<Partial<ApiGranuleRecord>[]> {
    log.debug(`translatePostgresRecordsToApiRecords number of records ${pgRecords.length} `);

    const { fields, includeFullRecord } = this.dbQueryParameters;

    const fileMapping: { [key: number]: PostgresFileRecord[] } = {};
    const executionMapping: { [key: number]: { url: string, granule_cumulus_id: number } } = {};
    const cumulusIds = pgRecords.map((record) => record.cumulus_id);
    if (includeFullRecord) {
      //get files
      const files = await getFilesByGranuleCumulusIds({
        connection: this.dbConnection,
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
        connection: this.dbConnection,
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
      const granulePgRecord = {
        ...item,
        created_at: new Date(item.created_at),
        updated_at: new Date(item.updated_at),
        beginning_date_time: returnNullOrUndefinedOrDate(item.beginning_date_time),
        ending_date_time: returnNullOrUndefinedOrDate(item.ending_date_time),
        last_update_date_time: returnNullOrUndefinedOrDate(item.last_update_date_time),
        processing_end_date_time: returnNullOrUndefinedOrDate(item.processing_end_date_time),
        processing_start_date_time: returnNullOrUndefinedOrDate(item.processing_start_date_time),
        production_date_time: returnNullOrUndefinedOrDate(item.production_date_time),
        timestamp: returnNullOrUndefinedOrDate(item.timestamp),
      };

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
      const fileRecords = fileMapping[granulePgRecord.cumulus_id] || [];
      const apiRecord = translatePostgresGranuleToApiGranuleWithoutDbQuery({
        granulePgRecord,
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
   * Build and execute search query
   *
   * @returns search result
   */
  async query() {
    return this.duckDBSearchExecutor.query((knexBuilder) =>
      this.buildSearch(knexBuilder));
  }
}
