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
  asyncOperationId: string,
  collection_cumulus_id: number,
  parent_cumulus_id: number,
  cumulus_version?: string,
  parentArn?: string,
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
   * check if joined async_ops table search is needed
   *
   * @returns whether collection search is needed
   */
  protected searchAsync(): boolean {
    const { not, term, terms } = this.dbQueryParameters;
    return !!(not?.asyncOperationId ||
       term?.asyncOperationId || terms?.asyncOperationId);
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
      asyncOperations: asyncOperationsTable,
    } = TableNames;

    const searchQuery = knex(`${this.tableName} as executions`)
      .leftJoin(`${this.tableName} as executions2`, 'executions.parent_cumulus_id', 'executions2.cumulus_id')
      .select('executions2.arn as parent_arn')
      .select('executions.*')
      .select({
        collectionName: `${collectionsTable}.name`,
        collectionVersion: `${collectionsTable}.version`,
        asyncOperationId: `${asyncOperationsTable}.id`,
        parentArn: 'executions2.arn',
      });

    const countQuery = knex(this.tableName)
      .count(`${this.tableName}.cumulus_id`);

    if (this.searchCollection()) {
      countQuery.innerJoin(collectionsTable, 'executions.collection_cumulus_id', `${collectionsTable}.cumulus_id`);
      searchQuery.innerJoin(collectionsTable, 'executions.collection_cumulus_id', `${collectionsTable}.cumulus_id`);
    } else {
      searchQuery.leftJoin(collectionsTable, 'executions.collection_cumulus_id', `${collectionsTable}.cumulus_id`);
    }

    if (this.searchAsync()) {
      countQuery.innerJoin(asyncOperationsTable, 'executions.async_operation_cumulus_id', `${asyncOperationsTable}.cumulus_id`);
      searchQuery.innerJoin(asyncOperationsTable, 'executions.async_operation_cumulus_id', `${asyncOperationsTable}.cumulus_id`);
    } else {
      searchQuery.leftJoin(asyncOperationsTable, 'executions.async_operation_cumulus_id', `${asyncOperationsTable}.cumulus_id`);
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
