import { Knex } from 'knex';
import Logger from '@cumulus/logger';
import pick from 'lodash/pick';
import set from 'lodash/set';
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
  asyncOperationId?: string;
  parentArn?: string;
}

/**
 * Class to build and execute db search query for executions
 */
export class ExecutionSearch extends BaseSearch {
  constructor(event: QueryEvent) {
    // estimate the table rowcount by default
    if (event?.queryStringParameters?.estimateTableRowCount !== 'false') {
      set(event, 'queryStringParameters.estimateTableRowCount', 'true');
    }
    super(event, 'execution');
  }

  /**
   * check if joined async_ops table search is needed
   *
   * @returns whether collection search is needed
   */
  protected searchAsync(): boolean {
    const { not, term, terms } = this.dbQueryParameters;
    return (!!(not?.asyncOperationId || term?.asyncOperationId || terms?.asyncOperationId));
  }

  /**
   * check if joined async_ops table search is needed
   *
   * @returns whether collection search is needed
   */
  protected searchParent(): boolean {
    const { not, term, terms } = this.dbQueryParameters;
    return (!!(not?.parentArn || term?.parentArn || terms?.parentArn));
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
      executions: executionsTable,
    } = TableNames;

    const searchQuery = knex(`${this.tableName}`)
      .select(`${this.tableName}.*`)
      .select({
        collectionName: `${collectionsTable}.name`,
        collectionVersion: `${collectionsTable}.version`,

      });

    if (this.searchAsync() || this.dbQueryParameters.includeFullRecord) {
      searchQuery.select({ asyncOperationId: `${asyncOperationsTable}.id` });
    }

    if (this.searchParent() || this.dbQueryParameters.includeFullRecord) {
      searchQuery.select({ parentArn: `${executionsTable}_parent.arn` });
    }

    const countQuery = knex(this.tableName)
      .count('*');

    if (this.searchCollection()) {
      countQuery.innerJoin(collectionsTable, `${this.tableName}.collection_cumulus_id`, `${collectionsTable}.cumulus_id`);
      searchQuery.innerJoin(collectionsTable, `${this.tableName}.collection_cumulus_id`, `${collectionsTable}.cumulus_id`);
    } else {
      searchQuery.leftJoin(collectionsTable, `${this.tableName}.collection_cumulus_id`, `${collectionsTable}.cumulus_id`);
    }

    if (this.searchAsync()) {
      countQuery.innerJoin(asyncOperationsTable, `${this.tableName}.async_operation_cumulus_id`, `${asyncOperationsTable}.cumulus_id`);
      searchQuery.innerJoin(asyncOperationsTable, `${this.tableName}.async_operation_cumulus_id`, `${asyncOperationsTable}.cumulus_id`);
    } else if (this.dbQueryParameters.includeFullRecord) {
      searchQuery.leftJoin(asyncOperationsTable, `${this.tableName}.async_operation_cumulus_id`, `${asyncOperationsTable}.cumulus_id`);
    }

    if (this.searchParent()) {
      countQuery.innerJoin(`${this.tableName} as ${this.tableName}_parent`, `${this.tableName}.parent_cumulus_id`, `${this.tableName}_parent.cumulus_id`);
      searchQuery.innerJoin(`${this.tableName} as ${this.tableName}_parent`, `${this.tableName}.parent_cumulus_id`, `${this.tableName}_parent.cumulus_id`);
    } else if (this.dbQueryParameters.includeFullRecord) {
      searchQuery.leftJoin(`${this.tableName} as ${this.tableName}_parent`, `${this.tableName}.parent_cumulus_id`, `${this.tableName}_parent.cumulus_id`);
    }
    return { countQuery, searchQuery };
  }

  /**
   * Build queries for infix and prefix
   *
   * @param params
   * @param [params.knex] - db client
   * @param params.countQuery - query builder for getting count
   * @param params.searchQuery - query builder for search
   * @param [params.dbQueryParameters] - db query parameters
   */
  protected buildInfixPrefixQuery(params: {
    knex?: Knex,
    countQuery: Knex.QueryBuilder,
    searchQuery: Knex.QueryBuilder,
    dbQueryParameters?: DbQueryParameters,
  }) {
    const { countQuery, searchQuery, dbQueryParameters } = params;
    const { infix, prefix } = dbQueryParameters ?? this.dbQueryParameters;
    if (infix) {
      [countQuery, searchQuery].forEach((query) => query.whereLike(`${this.tableName}.arn`, `%${infix}%`));
    }
    if (prefix) {
      [countQuery, searchQuery].forEach((query) => query.whereLike(`${this.tableName}.arn`, `%${prefix}%`));
    }
  }

  /**
   * Translate postgres records to api records
   *
   * @param pgRecords - postgres records returned from query
   * @returns translated api records
   */
  protected translatePostgresRecordsToApiRecords(pgRecords: ExecutionRecord[])
    : Partial<ApiExecutionRecord>[] {
    log.debug(`translatePostgresRecordsToApiRecords number of records ${pgRecords.length} `);
    const { fields } = this.dbQueryParameters;
    const apiRecords = pgRecords.map((executionRecord: ExecutionRecord) => {
      const { collectionName, collectionVersion, asyncOperationId, parentArn } = executionRecord;
      const collectionId = collectionName && collectionVersion
        ? constructCollectionId(collectionName, collectionVersion) : undefined;
      const apiRecord = translatePostgresExecutionToApiExecutionWithoutDbQuery({
        executionRecord,
        collectionId,
        asyncOperationId,
        parentArn,
      });
      return fields ? pick(apiRecord, fields) : apiRecord;
    });
    return apiRecords;
  }
}
