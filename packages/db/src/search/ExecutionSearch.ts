import { Knex } from 'knex';
import Logger from '@cumulus/logger';
import { ApiExecutionRecord } from '@cumulus/types/api/executions';
import { BaseSearch } from './BaseSearch';
import { DbQueryParameters, QueryEvent } from '../types/search';
import { translatePostgresExecutionToApiExecution } from '../translate/executions';
import { PostgresExecutionRecord } from '../types/execution';

const log = new Logger({ sender: '@cumulus/db/ExecutionSearch' });

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
    const countQuery = knex(this.tableName)
      .count(`${this.tableName}.cumulus_id`);

    const searchQuery = knex(this.tableName)
      .select(`${this.tableName}.*`);
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
  protected translatePostgresRecordsToApiRecords(pgRecords: PostgresExecutionRecord[], knex: Knex)
    : Partial<ApiExecutionRecord[]> {
    log.debug(`translatePostgresRecordsToApiRecords number of records ${pgRecords.length} `);
    const results: ApiExecutionRecord[] = [];
    // its only getting the first record for some reason, need to check why
    pgRecords.map(async (item) => results.push(await translatePostgresExecutionToApiExecution(item, knex)))
    return results;
  }
}
