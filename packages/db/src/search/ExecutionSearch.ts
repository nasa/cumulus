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

  protected buildSearch(knex: Knex) {
    const cteQueryBuilders = {};
    this.buildCTETermQuery({ knex, cteQueryBuilders });
    this.buildCTETermsQuery({ knex, cteQueryBuilders });
    this.buildCTEExistsQuery({ knex, cteQueryBuilders });
    this.buildCTENotMatchQuery({ knex, cteQueryBuilders });
    this.buildCTERangeQuery({ knex, cteQueryBuilders });
    this.buildCTEInfixPrefixQuery({ knex, cteQueryBuilders });
    const cteSearchQueryBuilder = knex.queryBuilder();
    const searchQuery = this.joinCTESearchTables({ cteSearchQueryBuilder, cteQueryBuilders });
    const cteCountQueryBuilder = knex.queryBuilder();
    const countQuery = this.joinCTECountTables({ cteCountQueryBuilder, cteQueryBuilders });
    this.buildSortQuery({ searchQuery: searchQuery, cteName: `${this.tableName}_cte` });
    if (this.dbQueryParameters.limit) searchQuery.limit(this.dbQueryParameters.limit);
    if (this.dbQueryParameters.offset) searchQuery.offset(this.dbQueryParameters.offset);

    log.debug(`buildSearch returns countQuery: ${countQuery?.toSQL().sql}, searchQuery: ${searchQuery.toSQL().sql}`);
    return { countQuery, searchQuery };
  }

  protected buildCTEInfixPrefixQuery(params: {
    knex: Knex;
    cteQueryBuilders: Record<string, Knex.QueryBuilder>;
    dbQueryParameters?: DbQueryParameters,
  }) {
    const { knex, cteQueryBuilders, dbQueryParameters } = params;
    const { infix, prefix } = dbQueryParameters ?? this.dbQueryParameters;

    if (!(`${this.tableName}` in cteQueryBuilders)) cteQueryBuilders[`${this.tableName}`] = knex.select('*').from(`${this.tableName}`);

    if (infix) {
      cteQueryBuilders[`${this.tableName}`].whereLike(`${this.tableName}.arn`, `%${infix}%`);
    }
    if (prefix) {
      cteQueryBuilders[`${this.tableName}`].whereLike(`${this.tableName}.arn`, `${prefix}%`);
    }
  }

  protected buildCTETermQuery(params: {
    knex: Knex,
    cteQueryBuilders: Record<string, Knex.QueryBuilder>;
    dbQueryParameters?: DbQueryParameters;
  }) {
    const {
      collections: collectionsTable,
      asyncOperations: asyncOperationsTable,
    } = TableNames;

    const { knex, cteQueryBuilders, dbQueryParameters } = params;
    const { term = {} } = dbQueryParameters ?? this.dbQueryParameters;

    this.buildCTETables({ knex, cteQueryBuilders, term });

    Object.entries(term).forEach(([name, value]) => {
      switch (name) {
        case 'collectionName':
          cteQueryBuilders[`${collectionsTable}`].where(`${collectionsTable}.name`, value);
          break;
        case 'collectionVersion':
          cteQueryBuilders[`${collectionsTable}`].where(`${collectionsTable}.version`, value);
          break;
        case 'asyncOperationId':
          cteQueryBuilders[`${asyncOperationsTable}`].where(`${asyncOperationsTable}.id`, value);
          break;
        case 'parentArn':
          cteQueryBuilders[`${this.tableName}_parent`].where(`${this.tableName}_parent.arn`, value);
          break;
        case 'error.Error':
          cteQueryBuilders[`${this.tableName}`].whereRaw(`${this.tableName}.error->>'Error' = ?`, value);
          break;
        default:
          cteQueryBuilders[`${this.tableName}`].where(`${this.tableName}.${name}`, value);
          break;
      }
    });
  }

  protected buildCTETermsQuery(params: {
    knex: Knex; cteQueryBuilders:
    Record<string, Knex.QueryBuilder>;
    dbQueryParameters?: DbQueryParameters;
  }) {
    const {
      collections: collectionsTable,
      asyncOperations: asyncOperationsTable,
    } = TableNames;

    const { knex, cteQueryBuilders, dbQueryParameters } = params;
    const { terms = {} } = dbQueryParameters ?? this.dbQueryParameters;
    const term = terms;
    this.buildCTETables({ knex, cteQueryBuilders, term });

    Object.entries(terms).forEach(([name, value]) => {
      switch (name) {
        case 'collectionName':
          cteQueryBuilders[`${collectionsTable}`].whereIn(`${collectionsTable}.name`, value);
          break;
        case 'collectionVersion':
          cteQueryBuilders[`${collectionsTable}`].whereIn(`${collectionsTable}.version`, value);
          break;
        case 'asyncOperationId':
          cteQueryBuilders[`${asyncOperationsTable}`].whereIn(`${asyncOperationsTable}.id`, value);
          break;
        case 'parentArn':
          cteQueryBuilders[`${this.tableName}_parent`].whereIn(`${this.tableName}_parent.arn`, value);
          break;
        case 'error.Error':
          if (Array.isArray(value) && value.length > 0) {
            cteQueryBuilders[`${this.tableName}`].whereRaw(
              `${this.tableName}.error->>'Error' IN (${value.map(() => '?').join(',')})`,
              value
            );
          }
          break;
        default:
          cteQueryBuilders[`${this.tableName}`].whereIn(`${this.tableName}.${name}`, value);
          break;
      }
    });
  }

  protected buildCTENotMatchQuery(params: {
    knex: Knex;
    cteQueryBuilders: Record<string, Knex.QueryBuilder>;
    dbQueryParameters?: DbQueryParameters;
  }) {
    const {
      collections: collectionsTable,
      asyncOperations: asyncOperationsTable,
    } = TableNames;

    const { knex, cteQueryBuilders, dbQueryParameters } = params;
    const { not: term = {} } = dbQueryParameters ?? this.dbQueryParameters;
    this.buildCTETables({ knex, cteQueryBuilders, term });

    Object.entries(term).forEach(([name, value]) => {
      switch (name) {
        case 'collectionName':
          cteQueryBuilders[`${collectionsTable}`].whereNot(`${collectionsTable}.name`, value);
          break;
        case 'collectionVersion':
          cteQueryBuilders[`${collectionsTable}`].whereNot(`${collectionsTable}.version`, value);
          break;
        case 'asyncOperationId':
          cteQueryBuilders[`${asyncOperationsTable}`].whereNot(`${asyncOperationsTable}.id`, value);
          break;
        case 'parentArn':
          cteQueryBuilders[`${this.tableName}_parent`].whereNot(`${this.tableName}_parent.arn`, value);
          break;
        case 'error.Error':
          cteQueryBuilders[`${this.tableName}`].whereRaw(`${this.tableName}.error->>'Error' != ?`, value);
          break;
        default:
          cteQueryBuilders[`${this.tableName}`].whereNot(`${this.tableName}.${name}`, value);
          break;
      }
    });
  }
  protected buildCTETables(params: {
    knex: Knex;
    cteQueryBuilders: Record<string, Knex.QueryBuilder>;
    term: any }) {
    const {
      collections: collectionsTable,
      asyncOperations: asyncOperationsTable,
    } = TableNames;

    const { knex, cteQueryBuilders, term } = params;

    //Object.entries(term).forEach(([name, value]) => {
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

  protected joinCTESearchTables(params: {
    cteSearchQueryBuilder: Knex.QueryBuilder;
    cteQueryBuilders: Record<string, Knex.QueryBuilder>;
  }) {
    const {
      collections: collectionsTable,
      asyncOperations: asyncOperationsTable,
    } = TableNames;

    const { cteSearchQueryBuilder, cteQueryBuilders } = params;
    Object.entries(cteQueryBuilders).forEach(([tableName, cteQuery]) => {
      cteSearchQueryBuilder.with(`${tableName}_cte`, cteQuery);
    });

    let mainTableName = `${this.tableName}`;
    if (`${this.tableName}` in cteQueryBuilders) {
      mainTableName = `${this.tableName}_cte`;
      cteSearchQueryBuilder.from(`${this.tableName}_cte`);
    } else {
      cteSearchQueryBuilder.from(`${this.tableName}`);
    }

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

    return cteSearchQueryBuilder;
  }

  protected joinCTECountTables(params: {
    cteCountQueryBuilder: Knex.QueryBuilder;
    cteQueryBuilders: Record<string, Knex.QueryBuilder>;
  }) {
    const {
      collections: collectionsTable,
      asyncOperations: asyncOperationsTable,
    } = TableNames;

    const { cteCountQueryBuilder, cteQueryBuilders } = params;
    Object.entries(cteQueryBuilders).forEach(([tableName, cteQuery]) => {
      cteCountQueryBuilder.with(`${tableName}_cte`, cteQuery);
    });

    let mainTableName = `${this.tableName}`;
    if (`${this.tableName}` in cteQueryBuilders) {
      mainTableName = `${this.tableName}_cte`;
      cteCountQueryBuilder.from(`${this.tableName}_cte`);
    } else {
      cteCountQueryBuilder.from(`${this.tableName}`);
    }

    let collectionsTableName = `${collectionsTable}`;
    if (`${collectionsTable}` in cteQueryBuilders) {
      collectionsTableName = `${collectionsTable}_cte`;
      cteCountQueryBuilder.innerJoin(`${collectionsTableName}`, `${mainTableName}.collection_cumulus_id`, `${collectionsTableName}.cumulus_id`);
    } else {
      cteCountQueryBuilder.leftJoin(`${collectionsTableName}`, `${mainTableName}.collection_cumulus_id`, `${collectionsTableName}.cumulus_id`);
    }

    let asyncOperationsTableName = `${asyncOperationsTable}`;
    if (`${asyncOperationsTable}` in cteQueryBuilders) {
      asyncOperationsTableName = `${asyncOperationsTable}_cte`;
      if (this.dbQueryParameters.includeFullRecord) {
        cteCountQueryBuilder.leftJoin(`${asyncOperationsTableName}`, `${mainTableName}.async_operation_cumulus_id`, `${asyncOperationsTableName}.cumulus_id`);
      } else {
        cteCountQueryBuilder.innerJoin(`${asyncOperationsTableName}`, `${mainTableName}.async_operation_cumulus_id`, `${asyncOperationsTableName}.cumulus_id`);
      }
    } else {
      cteCountQueryBuilder.leftJoin(`${asyncOperationsTableName}`, `${mainTableName}.async_operation_cumulus_id`, `${asyncOperationsTableName}.cumulus_id`);
    }

    let parentTableName = `${this.tableName}_parent`;
    if (`${this.tableName}_parent` in cteQueryBuilders) {
      parentTableName = `${this.tableName}_parent_cte`;
      if (this.dbQueryParameters.includeFullRecord) {
        cteCountQueryBuilder.leftJoin(`${mainTableName} as ${parentTableName}`, `${mainTableName}.parent_cumulus_id`, `${parentTableName}.cumulus_id`);
      } else {
        cteCountQueryBuilder.innerJoin(`${parentTableName}`, `${mainTableName}.parent_cumulus_id`, `${parentTableName}.cumulus_id`);
      }
    } else if (this.dbQueryParameters.includeFullRecord) {
      cteCountQueryBuilder.leftJoin(`${mainTableName} as ${parentTableName}`, `${mainTableName}.parent_cumulus_id`, `${parentTableName}.cumulus_id`);
    }
    cteCountQueryBuilder.countDistinct(
      `${mainTableName}.cumulus_id as count`
    );

    return cteCountQueryBuilder;
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
