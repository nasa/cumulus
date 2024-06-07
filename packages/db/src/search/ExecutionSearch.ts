import { Knex } from 'knex';
import Logger from '@cumulus/logger';
import { ApiExecutionRecord, ExecutionRecordStatus } from '@cumulus/types/api/executions';
import { BaseSearch } from './BaseSearch';
import { DbQueryParameters, QueryEvent } from '../types/search';
import { translatePostgresExecutionToApiExecutionWithoutDbQuery } from '../translate/executions';
import { PostgresExecutionRecord } from '../types/execution';
import { TableNames } from '../tables';
import { BaseRecord } from '../types/base';

const log = new Logger({ sender: '@cumulus/db/ExecutionSearch' });

interface ExecutionRecord extends BaseRecord, PostgresExecutionRecord {
  cumulus_id: number,
  arn: string,
  async_operation_cumulus_id: number,
  collection_cumulus_id: number,
  parent_cumulus_id: number,
  url: string,
  status: ExecutionRecordStatus,
  tasks: Object,
  error: Object,
  workflow_name: string,
  duration: number,
  original_payload: Object,
  final_payload: Object,
  timestamp?: Date,
  created_at: Date,
  updated_at: Date,
  collectionName?: string,
  collectionVersion?: string,
}

/**
 * Class to build and execute db search query for executions
 */
export class ExecutionSearch extends BaseSearch {
  constructor(event: QueryEvent) {
    super(event, 'execution');
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
      collections: collectionsTable,
    } = TableNames;
    const countQuery = knex(this.tableName)
      .count(`${this.tableName}.cumulus_id`);

    const searchQuery = knex(this.tableName)
      .select(`${this.tableName}.*`)
      .select({
        collectionName: `${collectionsTable}.name`,
        collectionVersion: `${collectionsTable}.version`,
      })
      .innerJoin(collectionsTable, `${this.tableName}.collection_cumulus_id`, `${collectionsTable}.cumulus_id`);

    if (this.searchCollection()) {
      countQuery.innerJoin(collectionsTable, `${this.tableName}.collection_cumulus_id`, `${collectionsTable}.cumulus_id`);
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
      countQuery.whereLike(`${this.tableName}.arn`, `%${infix}%`);
      searchQuery.whereLike(`${this.tableName}.arn`, `%${infix}%`);
    }
    if (prefix) {
      countQuery.whereLike(`${this.tableName}.arn`, `${prefix}%`);
      searchQuery.whereLike(`${this.tableName}.arn`, `${prefix}%`);
    }
  }

  /**
   * Translate postgres records to api records
   *
   * @param pgRecords - postgres records returned from query
   * @returns translated api records
   */
  protected translatePostgresRecordsToApiRecords(pgRecords: ExecutionRecord[])
    : Partial<ApiExecutionRecord[]> {
    log.debug(`translatePostgresRecordsToApiRecords number of records ${pgRecords.length} `);
    const results: ApiExecutionRecord[] = [];
    pgRecords.map((executionRecord) => {
      const collectionPgRecord = {
        cumulus_id: executionRecord.collection_cumulus_id,
        name: executionRecord.collectionName ?? '',
        version: executionRecord.collectionVersion ?? '',
      };
      const result = translatePostgresExecutionToApiExecutionWithoutDbQuery({
        executionRecord,
        collectionPgRecord,
      });
      return results.push(result);
    });
    return results;
  }
}
