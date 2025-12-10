import { Knex } from 'knex';
import Logger from '@cumulus/logger';
import pick from 'lodash/pick';
import set from 'lodash/set';
import { constructCollectionId } from '@cumulus/message/Collections';
import { ApiExecutionRecord } from '@cumulus/types/api/executions';

// Import OpenTelemetry
import { trace } from '@opentelemetry/api';

import { BaseSearch } from './BaseSearch';
import { DbQueryParameters, QueryEvent } from '../types/search';
import { translatePostgresExecutionToApiExecutionWithoutDbQuery } from '../translate/executions';
import { PostgresExecutionRecord } from '../types/execution';
import { TableNames } from '../tables';
import { BaseRecord } from '../types/base';

const log = new Logger({ sender: '@cumulus/db/ExecutionSearch' });

// Get the tracer
const tracer = trace.getTracer('cumulus-db');

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
   * check if joined async_operations table search is needed
   *
   * @returns whether async_operations search is needed
   */
  protected searchAsync(): boolean {
    const { not, term, terms } = this.dbQueryParameters;
    return (!!(not?.asyncOperationId || term?.asyncOperationId || terms?.asyncOperationId));
  }

  /**
   * check if joined parent execution table search is needed
   *
   * @returns whether parent execution search is needed
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
    return tracer.startActiveSpan('ExecutionSearch.buildBasicQuery', (span) => {
      try {
        const {
          collections: collectionsTable,
          asyncOperations: asyncOperationsTable,
          executions: executionsTable,
        } = TableNames;

        span.setAttribute('db.table', this.tableName);
        span.setAttribute('db.collections_table', collectionsTable);
        span.setAttribute('db.async_operations_table', asyncOperationsTable);
        span.setAttribute('db.executions_table', executionsTable);

        const searchQuery = knex(`${this.tableName}`)
          .select(`${this.tableName}.*`)
          .select({
            collectionName: `${collectionsTable}.name`,
            collectionVersion: `${collectionsTable}.version`,
          });

        const joinsUsed = [];
        const isSearchAsync = this.searchAsync();
        const isSearchParent = this.searchParent();
        const includeFullRecord = this.dbQueryParameters.includeFullRecord;

        span.setAttribute('query.search_async', isSearchAsync);
        span.setAttribute('query.search_parent', isSearchParent);
        span.setAttribute('query.include_full_record', includeFullRecord || false);

        if (isSearchAsync || includeFullRecord) {
          searchQuery.select({ asyncOperationId: `${asyncOperationsTable}.id` });
        }

        if (isSearchParent || includeFullRecord) {
          searchQuery.select({ parentArn: `${executionsTable}_parent.arn` });
        }

        const countQuery = knex(this.tableName)
          .count('*');

        if (this.searchCollection()) {
          joinsUsed.push('collections-inner');
          countQuery.innerJoin(collectionsTable, `${this.tableName}.collection_cumulus_id`, `${collectionsTable}.cumulus_id`);
          searchQuery.innerJoin(collectionsTable, `${this.tableName}.collection_cumulus_id`, `${collectionsTable}.cumulus_id`);
        } else {
          joinsUsed.push('collections-left');
          searchQuery.leftJoin(collectionsTable, `${this.tableName}.collection_cumulus_id`, `${collectionsTable}.cumulus_id`);
        }

        if (isSearchAsync) {
          joinsUsed.push('async_operations-inner');
          countQuery.innerJoin(asyncOperationsTable, `${this.tableName}.async_operation_cumulus_id`, `${asyncOperationsTable}.cumulus_id`);
          searchQuery.innerJoin(asyncOperationsTable, `${this.tableName}.async_operation_cumulus_id`, `${asyncOperationsTable}.cumulus_id`);
        } else if (includeFullRecord) {
          joinsUsed.push('async_operations-left');
          searchQuery.leftJoin(asyncOperationsTable, `${this.tableName}.async_operation_cumulus_id`, `${asyncOperationsTable}.cumulus_id`);
        }

        if (isSearchParent) {
          joinsUsed.push('parent_execution-inner');
          countQuery.innerJoin(`${this.tableName} as ${this.tableName}_parent`, `${this.tableName}.parent_cumulus_id`, `${this.tableName}_parent.cumulus_id`);
          searchQuery.innerJoin(`${this.tableName} as ${this.tableName}_parent`, `${this.tableName}.parent_cumulus_id`, `${this.tableName}_parent.cumulus_id`);
        } else if (includeFullRecord) {
          joinsUsed.push('parent_execution-left');
          searchQuery.leftJoin(`${this.tableName} as ${this.tableName}_parent`, `${this.tableName}.parent_cumulus_id`, `${this.tableName}_parent.cumulus_id`);
        }

        span.setAttribute('query.joins', joinsUsed.join(','));
        span.setAttribute('query.joins_count', joinsUsed.length);

        return { countQuery, searchQuery };
      } finally {
        span.end();
      }
    });
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
    return tracer.startActiveSpan('ExecutionSearch.buildInfixPrefixQuery', (span) => {
      try {
        const { countQuery, searchQuery, dbQueryParameters } = params;
        const { infix, prefix } = dbQueryParameters ?? this.dbQueryParameters;

        if (infix) {
          span.setAttribute('query.has_infix', true);
          span.setAttribute('query.infix_length', infix.length);
          [countQuery, searchQuery].forEach((query) => query.whereLike(`${this.tableName}.arn`, `%${infix}%`));
        }
        if (prefix) {
          span.setAttribute('query.has_prefix', true);
          span.setAttribute('query.prefix_length', prefix.length);
          [countQuery, searchQuery].forEach((query) => query.whereLike(`${this.tableName}.arn`, `${prefix}%`));
        }
      } finally {
        span.end();
      }
    });
  }

  /**
   * Translate postgres records to api records
   *
   * @param pgRecords - postgres records returned from query
   * @returns translated api records
   */
  protected translatePostgresRecordsToApiRecords(pgRecords: ExecutionRecord[])
    : Partial<ApiExecutionRecord>[] {
    return tracer.startActiveSpan('ExecutionSearch.translatePostgresRecordsToApiRecords', (span) => {
      try {
        const recordCount = pgRecords.length;
        span.setAttribute('db.record_count', recordCount);
        span.setAttribute('query.has_field_filter', !!this.dbQueryParameters.fields);

        log.debug(`translatePostgresRecordsToApiRecords number of records ${recordCount}`);

        const { fields } = this.dbQueryParameters;

        const translationStartTime = Date.now();

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

        const translationDuration = Date.now() - translationStartTime;

        span.setAttribute('translation.duration_ms', translationDuration);
        span.setAttribute('translation.records_count', apiRecords.length);

        // Track execution characteristics
        const executionsWithCollections = pgRecords.filter(r => r.collectionName).length;
        const executionsWithAsyncOps = pgRecords.filter(r => r.asyncOperationId).length;
        const executionsWithParents = pgRecords.filter(r => r.parentArn).length;

        span.setAttribute('executions.with_collections', executionsWithCollections);
        span.setAttribute('executions.without_collections', recordCount - executionsWithCollections);
        span.setAttribute('executions.with_async_operations', executionsWithAsyncOps);
        span.setAttribute('executions.with_parent_executions', executionsWithParents);

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
