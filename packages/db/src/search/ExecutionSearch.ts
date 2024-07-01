import { Knex } from 'knex';
import Logger from '@cumulus/logger';
import { constructCollectionId } from '@cumulus/message/Collections';
import { ApiExecutionRecord } from '@cumulus/types/api/executions';
import { BaseSearch } from './BaseSearch';
import { DbQueryParameters, QueryEvent } from '../types/search';
import { translatePostgresExecutionToApiExecutionWithoutDbQuery } from '../translate/executions';
import { PostgresExecutionRecord } from '../types/execution';
import { TableNames } from '../tables';
import { BaseRecord } from '../types/base';

const log = new Logger({ sender: '@cumulus/db/ExecutionSearch' });

interface ExecutionRecord extends BaseRecord, PostgresExecutionRecord {
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

    const searchQuery = knex(`${this.tableName} as ${this.tableName}`)
      .leftJoin(`${this.tableName} as ${this.tableName}-parent`, `${this.tableName}.parent_cumulus_id`, `${this.tableName}-parent.cumulus_id`)
      .select(`${this.tableName}.*`)
      .select({
        collectionName: `${collectionsTable}.name`,
        collectionVersion: `${collectionsTable}.version`,
        asyncOperationId: `${asyncOperationsTable}.id`,
        parentArn: `${this.tableName}-parent.arn`,
      });

    const countQuery = knex(this.tableName)
      .count(`${this.tableName}.cumulus_id`);

    if (this.searchCollection()) {
      countQuery.innerJoin(collectionsTable, `${this.tableName}.collection_cumulus_id`, `${collectionsTable}.cumulus_id`);
      searchQuery.innerJoin(collectionsTable, `${this.tableName}.collection_cumulus_id`, `${collectionsTable}.cumulus_id`);
    } else {
      searchQuery.leftJoin(collectionsTable, `${this.tableName}.collection_cumulus_id`, `${collectionsTable}.cumulus_id`);
    }

    if (this.searchAsync()) {
      countQuery.innerJoin(asyncOperationsTable, `${this.tableName}.async_operation_cumulus_id`, `${asyncOperationsTable}.cumulus_id`);
      searchQuery.innerJoin(asyncOperationsTable, `${this.tableName}.async_operation_cumulus_id`, `${asyncOperationsTable}.cumulus_id`);
    } else {
      searchQuery.leftJoin(asyncOperationsTable, `${this.tableName}.async_operation_cumulus_id`, `${asyncOperationsTable}.cumulus_id`);
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
      const name = executionRecord.collectionName;
      const version = executionRecord.collectionVersion;
      const collectionId = name && version ? constructCollectionId(name, version) : undefined;
      const result = translatePostgresExecutionToApiExecutionWithoutDbQuery({
        executionRecord,
        collectionId,
      });
      return results.push(result);
    });
    return results;
  }
}
