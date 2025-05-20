import { Knex } from 'knex';
import pick from 'lodash/pick';

import { ApiAsyncOperation } from '@cumulus/types/api/async_operations';
import Logger from '@cumulus/logger';

import { BaseSearch } from './BaseSearch';
import { DbQueryParameters, QueryEvent } from '../types/search';
import { PostgresAsyncOperationRecord } from '../types/async_operation';
import { translatePostgresAsyncOperationToApiAsyncOperation } from '../translate/async_operations';

const log = new Logger({ sender: '@cumulus/db/AsyncOperationSearch' });

/**
 * Class to build and execute db search query for asyncOperation
 */
export class AsyncOperationSearch extends BaseSearch {
  constructor(event: QueryEvent) {
    super(event, 'asyncOperation');
  }

  /**
   * Build queries for infix and prefix
   *
   * @param params
   * @param params.cteQueryBuilder - common table expression query for search
   * @param [params.dbQueryParameters] - db query parameters
   * @param [params.cteName] - CTE table name
   */
  protected buildInfixPrefixQuery(params: {
    cteQueryBuilder: Knex.QueryBuilder,
    dbQueryParameters?: DbQueryParameters,
    cteName?: string,
  }) {
    const { cteQueryBuilder, dbQueryParameters } = params;
    const { infix, prefix } = dbQueryParameters ?? this.dbQueryParameters;
    if (infix) {
      cteQueryBuilder.whereRaw(`${this.tableName}.id::text like ?`, `%${infix}%`);
    }
    if (prefix) {
      cteQueryBuilder.whereRaw(`${this.tableName}.id::text like ?`, `${prefix}%`);
    }
  }

  /**
   * Translate postgres records to api records
   *
   * @param pgRecords - postgres records returned from query
   * @returns translated api records
   */
  protected translatePostgresRecordsToApiRecords(pgRecords: PostgresAsyncOperationRecord[])
    : Partial<ApiAsyncOperation>[] {
    log.debug(`translatePostgresRecordsToApiRecords number of records ${pgRecords.length} `);
    const { fields } = this.dbQueryParameters;
    const apiRecords = pgRecords.map((item: PostgresAsyncOperationRecord) => {
      const pgAsyncOperation = item;
      const apiRecord = translatePostgresAsyncOperationToApiAsyncOperation(pgAsyncOperation);
      return fields ? pick(apiRecord, fields) : apiRecord;
    });
    return apiRecords;
  }
}
