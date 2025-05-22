import { Knex } from 'knex';
import pick from 'lodash/pick';
import set from 'lodash/set';

import { constructCollectionId } from '@cumulus/message/Collections';
import { ApiExecutionRecord } from '@cumulus/types/api/executions';
import Logger from '@cumulus/logger';

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
   * Build the search query
   *
   * @param knex - DB client
   * @returns queries for getting count and search result
   */
  // protected buildSearch(knex: Knex): {
  //   countQuery?: Knex.QueryBuilder,
  //   searchQuery: Knex.QueryBuilder,
  // } {
  //   const {
  //     collections: collectionsTable,
  //     asyncOperations: asyncOperationsTable,
  //   } = TableNames;
  //   const { countQuery, searchQuery } = super.buildCteSearch(knex);
  //   if (this.searchCollection()) {
  //     countQuery.innerJoin(collectionsTable, `${this.tableName}.collection_cumulus_id`, `${collectionsTable}.cumulus_id`);
  //   }

  //   if (this.searchAsync()) {
  //     countQuery.innerJoin(asyncOperationsTable, `${this.tableName}.async_operation_cumulus_id`, `${asyncOperationsTable}.cumulus_id`);
  //   }

  //   if (this.searchParent()) {
  //     countQuery.innerJoin(`${this.tableName} as ${this.tableName}_parent`, `${this.tableName}.parent_cumulus_id`, `${this.tableName}_parent.cumulus_id`);
  //   }
  //   return { countQuery, searchQuery };
  // }

  protected buildBasicQuery(knex: Knex): {
    countQuery: Knex.QueryBuilder,
    cteQueryBuilder: Knex.QueryBuilder,
  } {
    const {
      collections: collectionsTable,
      asyncOperations: asyncOperationsTable,
    } = TableNames;

    const countQuery = knex(this.tableName)
      .count('*');

    const cteQueryBuilder = knex(this.tableName)
      .select(
        `${this.tableName}.*`,
        `${collectionsTable}.name as collectionName`,
        `${collectionsTable}.version as collectionVersion`
      );

    if (this.searchAsync() || this.dbQueryParameters.includeFullRecord) {
      cteQueryBuilder.select(`${asyncOperationsTable}.id as asyncOperationId`);
    }

    if (this.searchParent() || this.dbQueryParameters.includeFullRecord) {
      cteQueryBuilder.select(`${this.tableName}_parent.arn as parentArn`);
    }

    if (this.searchCollection()) {
      countQuery.innerJoin(collectionsTable, `${this.tableName}.collection_cumulus_id`, `${collectionsTable}.cumulus_id`);
      cteQueryBuilder.innerJoin(collectionsTable, `${this.tableName}.collection_cumulus_id`, `${collectionsTable}.cumulus_id`);
    } else {
      cteQueryBuilder.leftJoin(collectionsTable, `${this.tableName}.collection_cumulus_id`, `${collectionsTable}.cumulus_id`);
    }

    if (this.searchAsync()) {
      countQuery.innerJoin(asyncOperationsTable, `${this.tableName}.async_operation_cumulus_id`, `${asyncOperationsTable}.cumulus_id`);
      cteQueryBuilder.innerJoin(asyncOperationsTable, `${this.tableName}.async_operation_cumulus_id`, `${asyncOperationsTable}.cumulus_id`);
    } else if (this.dbQueryParameters.includeFullRecord) {
      cteQueryBuilder.leftJoin(asyncOperationsTable, `${this.tableName}.async_operation_cumulus_id`, `${asyncOperationsTable}.cumulus_id`);
    }

    if (this.searchParent()) {
      countQuery.innerJoin(`${this.tableName} as ${this.tableName}_parent`, `${this.tableName}.parent_cumulus_id`, `${this.tableName}_parent.cumulus_id`);
      cteQueryBuilder.innerJoin(`${this.tableName} as ${this.tableName}_parent`, `${this.tableName}.parent_cumulus_id`, `${this.tableName}_parent.cumulus_id`);
    } else if (this.dbQueryParameters.includeFullRecord) {
      cteQueryBuilder.leftJoin(`${this.tableName} as ${this.tableName}_parent`, `${this.tableName}.parent_cumulus_id`, `${this.tableName}_parent.cumulus_id`);
    }

    return { countQuery, cteQueryBuilder };
  }

  /**
   * Build query for infix and prefix search
   *
   * @param params
   * @param params.countQuery - count query
   * @param params.cteQueryBuilder - query builder
   * @param [params.dbQueryParameters] - db query parameters
   */
  protected buildInfixPrefixQuery(params: {
    countQuery: Knex.QueryBuilder,
    cteQueryBuilder: Knex.QueryBuilder,
    dbQueryParameters?: DbQueryParameters,
  }) {
    const { countQuery, cteQueryBuilder, dbQueryParameters } = params;
    const { infix, prefix } = dbQueryParameters ?? this.dbQueryParameters;
    if (infix) {
      [countQuery, cteQueryBuilder].forEach((query) => query.whereLike(`${this.tableName}.arn`, `%${infix}%`));
    }
    if (prefix) {
      [countQuery, cteQueryBuilder].forEach((query) => query.whereLike(`${this.tableName}.arn`, `${prefix}%`));
    }
  }

  /**
   * Build CTE term query for search
   *
   * @param params
   * @param params.countQuery - count query
   * @param params.knex - DB client
   * @param params.cteQueryBuilders - object that holds query builders
   * @param [params.dbQueryParameters] - db query parameters
   */
  protected buildCteTableTermQuery(params: {
    countQuery: Knex.QueryBuilder,
    knex: Knex,
    cteQueryBuilders: Record<string, Knex.QueryBuilder>;
    dbQueryParameters?: DbQueryParameters;
  }) {
    super.buildCteTermQuery({ ...params });
  }

  /**
   * Build CTE terms query for search
   *
   * @param params
   * @param params.knex - DB client
   * @param params.cteQueryBuilders - object that holds query builders
   * @param [params.dbQueryParameters] - db query parameters
   */
  protected buildCteTableTermsQuery(params: {
    countQuery: Knex.QueryBuilder,
    knex: Knex;
    cteQueryBuilders: Record<string, Knex.QueryBuilder>;
    dbQueryParameters?: DbQueryParameters;
  }) {
    super.buildCteTermsQuery({ isExecution: true, ...params });
  }

  /**
   * Build CTE not match query for search
   *
   * @param params
   * @param params.countQuery - count query
   * @param params.knex - DB client
   * @param params.cteQueryBuilders - object that holds query builders
   * @param [params.dbQueryParameters] - db query parameters
   */
  protected buildCteTableNotMatchQuery(params: {
    countQuery: Knex.QueryBuilder,
    knex: Knex;
    cteQueryBuilders: Record<string, Knex.QueryBuilder>;
    dbQueryParameters?: DbQueryParameters;
  }) {
    super.buildCteNotMatchQuery({ isExecution: true, ...params });
  }

  /**
   * Build CTE tables for search
   *
   * @param params
   * @param params.knex - DB client
   * @param params.cteQueryBuilders - object that holds query builders
   * @param param.term - db query parameter for term for building table
   */
  protected buildCteTables(params: {
    knex: Knex;
    cteQueryBuilders: Record<string, Knex.QueryBuilder>;
    term: any
  }) {
    const {
      collections: collectionsTable,
      asyncOperations: asyncOperationsTable,
    } = TableNames;

    const { knex, cteQueryBuilders, term } = params;

    Object.keys(term).forEach((name) => {
      switch (name) {
        case 'collectionVersion':
        case 'collectionName':
          if (!(`${collectionsTable}` in cteQueryBuilders)) {
            cteQueryBuilders[`${collectionsTable}`] = knex.select('*').from(`${collectionsTable}`);
          }
          break;
        case 'parentArn':
          if (!(`${this.tableName}_parent` in cteQueryBuilders)) {
            cteQueryBuilders[`${this.tableName}_parent`] = knex.select('*').from(`${this.tableName} as ${this.tableName}_parent`);
          }
          break;
        case 'error.Error':
        default:
          if (!(`${this.tableName}` in cteQueryBuilders)) {
            cteQueryBuilders[`${this.tableName}`] = knex.select('*').from(`${this.tableName}`);
          }
          break;
      }
    });

    if (this.searchAsync() || this.dbQueryParameters.includeFullRecord) {
      cteQueryBuilders[`${asyncOperationsTable}`] = knex.select('*').from(`${asyncOperationsTable}`);
    }

    if ((this.searchParent() || this.dbQueryParameters.includeFullRecord) && !(`${this.tableName}_parent` in cteQueryBuilders)) {
      cteQueryBuilders[`${this.tableName}_parent`] = knex.select('*').from(`${this.tableName} as ${this.tableName}_parent`);
    }
  }

  /**
   * Join CTE term queries for search
   *
   * @param params
   * @param params.knex - DB client
   * @param params.cteSearchQueryBuilder - CTE query for search
   * @param params.cteQueryBuilders - object that holds query builders
   * @returns joined CTE query builder for search
   */
  protected joinCteTables(params: {
    knex: Knex,
    cteSearchQueryBuilder: Knex.QueryBuilder;
    cteQueryBuilders: Record<string, Knex.QueryBuilder>;
  }) : { searchQuery: Knex.QueryBuilder } {
    const {
      collections: collectionsTable,
      asyncOperations: asyncOperationsTable,
    } = TableNames;

    const { knex, cteSearchQueryBuilder, cteQueryBuilders } = params;
    Object.entries(cteQueryBuilders).forEach(([tableName, cteQuery]) => {
      if (tableName === this.tableName) {
        cteSearchQueryBuilder.with(`${tableName}_inner_cte`, cteQuery);
      } else {
        cteSearchQueryBuilder.with(`${tableName}_cte`, cteQuery);
      }
    });

    const mainTableName = `${this.tableName}_inner_cte`;
    cteSearchQueryBuilder.from(`${mainTableName}`);

    let collectionsTableName = `${collectionsTable}`;
    if (`${collectionsTable}` in cteQueryBuilders) {
      collectionsTableName = `${collectionsTable}_cte`;
      cteSearchQueryBuilder.innerJoin(`${collectionsTableName}`, `${mainTableName}.collection_cumulus_id`, `${collectionsTableName}.cumulus_id`);
    } else {
      cteSearchQueryBuilder.leftJoin(`${collectionsTableName}`, `${mainTableName}.collection_cumulus_id`, `${collectionsTableName}.cumulus_id`);
    }

    let asyncOperationsTableName = `${asyncOperationsTable}`;
    if (`${asyncOperationsTable}` in cteQueryBuilders) {
      asyncOperationsTableName = `${asyncOperationsTable}_cte`;
      if (this.dbQueryParameters.includeFullRecord) {
        cteSearchQueryBuilder.leftJoin(`${asyncOperationsTableName}`, `${mainTableName}.async_operation_cumulus_id`, `${asyncOperationsTableName}.cumulus_id`);
      } else {
        cteSearchQueryBuilder.innerJoin(`${asyncOperationsTableName}`, `${mainTableName}.async_operation_cumulus_id`, `${asyncOperationsTableName}.cumulus_id`);
      }
    } else {
      cteSearchQueryBuilder.leftJoin(`${asyncOperationsTableName}`, `${mainTableName}.async_operation_cumulus_id`, `${asyncOperationsTableName}.cumulus_id`);
    }

    let parentTableName = `${this.tableName}_parent`;
    if (`${this.tableName}_parent` in cteQueryBuilders) {
      parentTableName = `${this.tableName}_parent_cte`;
      if (this.dbQueryParameters.includeFullRecord) {
        cteSearchQueryBuilder.leftJoin(`${mainTableName} as ${parentTableName}`, `${mainTableName}.parent_cumulus_id`, `${parentTableName}.cumulus_id`);
      } else {
        cteSearchQueryBuilder.innerJoin(`${parentTableName}`, `${mainTableName}.parent_cumulus_id`, `${parentTableName}.cumulus_id`);
      }
    } else if (this.dbQueryParameters.includeFullRecord) {
      cteSearchQueryBuilder.leftJoin(`${mainTableName} as ${parentTableName}`, `${mainTableName}.parent_cumulus_id`, `${parentTableName}.cumulus_id`);
    }
    cteSearchQueryBuilder.select(
      `${mainTableName}.*`,
      `${collectionsTableName}.name as collectionName`,
      `${collectionsTableName}.version as collectionVersion`
    );

    if (this.searchAsync() || this.dbQueryParameters.includeFullRecord) {
      cteSearchQueryBuilder.select(`${asyncOperationsTableName}.id as asyncOperationId`);
    }

    if (this.searchParent() || this.dbQueryParameters.includeFullRecord) {
      cteSearchQueryBuilder.select(`${parentTableName}.arn as parentArn`);
    }

    if (this.dbQueryParameters.limit) cteSearchQueryBuilder.limit(this.dbQueryParameters.limit);
    if (this.dbQueryParameters.offset) cteSearchQueryBuilder.offset(this.dbQueryParameters.offset);

    const searchQuery = knex.with(`${this.tableName}_cte`, cteSearchQueryBuilder).select('*').from(`${this.tableName}_cte`);

    return { searchQuery };
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
