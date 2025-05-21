import { Knex } from 'knex';
import Logger from '@cumulus/logger';
import pick from 'lodash/pick';
import omit from 'lodash/omit';
import set from 'lodash/set';
import { constructCollectionId } from '@cumulus/message/Collections';
import { ApiExecutionRecord } from '@cumulus/types/api/executions';
import { BaseSearch } from './BaseSearch';
import { DbQueryParameters, QueriableType, QueryEvent } from '../types/search';
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
  protected buildSearch(knex: Knex)
    : {
      countQuery?: Knex.QueryBuilder,
      searchQuery: Knex.QueryBuilder,
    } {
    const {
      collections: collectionsTable,
      asyncOperations: asyncOperationsTable,
    } = TableNames;
    const { countQuery, searchQuery } = super.buildCteSearch(knex);
    if (this.searchCollection()) {
      countQuery.innerJoin(collectionsTable, `${this.tableName}.collection_cumulus_id`, `${collectionsTable}.cumulus_id`);
    }

    if (this.searchAsync()) {
      countQuery.innerJoin(asyncOperationsTable, `${this.tableName}.async_operation_cumulus_id`, `${asyncOperationsTable}.cumulus_id`);
    }

    if (this.searchParent()) {
      countQuery.innerJoin(`${this.tableName} as ${this.tableName}_parent`, `${this.tableName}.parent_cumulus_id`, `${this.tableName}_parent.cumulus_id`);
    }
    return { countQuery, searchQuery };
  }

  /**
   * Build query for infix and prefix search
   *
   * @param params
   * @param params.cteQueryBuilder - query builder
   * @param [params.dbQueryParameters] - db query parameters
   * @param [params.cteName] - CTE name
   */
  protected buildInfixPrefixQuery(params: {
    cteQueryBuilder: Knex.QueryBuilder,
    dbQueryParameters?: DbQueryParameters,
    cteName?: string,
  }) {
    const { cteQueryBuilder, dbQueryParameters, cteName } = params;
    const { infix, prefix } = dbQueryParameters ?? this.dbQueryParameters;

    const table = cteName || this.tableName;

    if (infix) {
      cteQueryBuilder.whereLike(`${table}.arn`, `%${infix}%`);
    }
    if (prefix) {
      cteQueryBuilder.whereLike(`${table}.arn`, `${prefix}%`);
    }
  }

  /**
   * Build CTE term query for search
   *
   * @param params
   * @param params.knex - DB client
   * @param params.cteQueryBuilders - object that holds query builders
   * @param [params.dbQueryParameters] - db query parameters
   */
  protected buildCteTermQuery(params: {
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
    this.buildCteTables({ knex, cteQueryBuilders, term });

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

  /**
   * Build CTE terms query for search
   *
   * @param params
   * @param params.knex - DB client
   * @param params.cteQueryBuilders - object that holds query builders
   * @param [params.dbQueryParameters] - db query parameters
   */
  protected buildCteTermsQuery(params: {
    knex: Knex;
    cteQueryBuilders: Record<string, Knex.QueryBuilder>;
    dbQueryParameters?: DbQueryParameters;
  }) {
    const {
      collections: collectionsTable,
      asyncOperations: asyncOperationsTable,
    } = TableNames;

    const { knex, cteQueryBuilders, dbQueryParameters } = params;
    const { terms = {} } = dbQueryParameters ?? this.dbQueryParameters;
    const term = terms;
    this.buildCteTables({ knex, cteQueryBuilders, term });

    // collection name and version are searched in pair
    if (terms.collectionName && terms.collectionVersion
      && terms.collectionName.length > 0
      && terms.collectionVersion.length > 0) {
      const collectionPair: QueriableType[][] = [];
      for (let i = 0; i < terms.collectionName.length; i += 1) {
        const name = terms.collectionName[i];
        const version = terms.collectionVersion[i];
        if (name && version) collectionPair.push([name, version]);
      }
      cteQueryBuilders[`${collectionsTable}`].whereIn([`${collectionsTable}.name`, `${collectionsTable}.version`], collectionPair);
    }

    Object.entries(omit(terms, ['collectionName', 'collectionVersion'])).forEach(([name, value]) => {
      switch (name) {
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

  /**
   * Build CTE not match query for search
   *
   * @param params
   * @param params.knex - DB client
   * @param params.cteQueryBuilders - object that holds query builders
   * @param [params.dbQueryParameters] - db query parameters
   */
  protected buildCteNotMatchQuery(params: {
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
    this.buildCteTables({ knex, cteQueryBuilders, term });

    // collection name and version are searched in pair
    if (term.collectionName && term.collectionVersion) {
      cteQueryBuilders[`${collectionsTable}`].whereNot({
        [`${collectionsTable}.name`]: term.collectionName,
        [`${collectionsTable}.version`]: term.collectionVersion,
      });
    }

    Object.entries(omit(term, ['collectionName', 'collectionVersion'])).forEach(([name, value]) => {
      switch (name) {
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
   * @param params.cteSearchQueryBuilder - CTE query for search
   * @param params.cteQueryBuilders - object that holds query builders
   * @returns joined CTE query builder for search
   */
  protected joinCteTables(params: {
    cteSearchQueryBuilder: Knex.QueryBuilder;
    cteQueryBuilders: Record<string, Knex.QueryBuilder>;
  }) : { cteSearchQueryBuilder: Knex.QueryBuilder } {
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

    return { cteSearchQueryBuilder };
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
