import { knex, Knex } from 'knex';
import pick from 'lodash/pick';
import { DuckDBConnection } from '@duckdb/node-api';

import { ApiGranuleRecord } from '@cumulus/types/api/granules';
import Logger from '@cumulus/logger';

import { prepareBindings } from './duckdbHelpers';
import { GranuleRecord, GranuleSearch } from '../search/GranuleSearch';
import { QueryEvent } from '../types/search';
import { translatePostgresGranuleToApiGranuleWithoutDbQuery } from '../translate/granules';
import { FilePgModel } from '../models/file';
import { PostgresFileRecord } from '../types/file';
import { getExecutionInfoByGranuleCumulusIds } from '../lib/execution';

const log = new Logger({ sender: '@cumulus/db/GranuleSearch' });

/**
 * Class to build and execute db search query for granules
 */
export class GranuleS3Search extends GranuleSearch {
  private duckDbConn: DuckDBConnection;
  private knexBuilder: Knex;

  constructor(event: QueryEvent, duckDbConn: DuckDBConnection) {
    super(event);
    this.duckDbConn = duckDbConn;
    // Use 'pg' dialect to generate DuckDB-compatible SQL ($1, $2, etc.)
    this.knexBuilder = knex({ client: 'pg' });
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
      //get Files
      const fileModel = new FilePgModel();
      const files = await fileModel.searchByGranuleCumulusIds(knexClient, cumulusIds);
      files.forEach((file) => {
        if (!(file.granule_cumulus_id in fileMapping)) {
          fileMapping[file.granule_cumulus_id] = [];
        }
        fileMapping[file.granule_cumulus_id].push(file);
      });

      //get Executions
      const executions = await getExecutionInfoByGranuleCumulusIds({
        knexOrTransaction: knexClient,
        granuleCumulusIds: cumulusIds,
      });
      executions.forEach((execution) => {
        if (!(execution.granule_cumulus_id in executionMapping)) {
          executionMapping[execution.granule_cumulus_id] = execution;
        }
      });
    }
    const apiRecords = pgRecords.map((item: GranuleRecord) => {
      const granulePgRecord = item;
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

      const meta = this._metaTemplate();
      meta.limit = this.dbQueryParameters.limit;
      meta.page = this.dbQueryParameters.page;
      meta.count = Number(countResult[0]?.count ?? 0);

      const apiRecords = await this.translatePostgresRecordsToApiRecords(
        pgRecords as unknown as GranuleRecord[], this.knexBuilder
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
