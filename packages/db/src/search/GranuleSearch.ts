import { Knex } from 'knex';
import pick from 'lodash/pick';
import set from 'lodash/set';
import { ApiGranuleRecord } from '@cumulus/types/api/granules';
import Logger from '@cumulus/logger';

import { BaseRecord } from '../types/base';
import { BaseSearch } from './BaseSearch';
import { DbQueryParameters, QueryEvent } from '../types/search';
import { PostgresGranuleRecord } from '../types/granule';
import { translatePostgresGranuleToApiGranuleWithoutDbQuery } from '../translate/granules';
import { TableNames } from '../tables';
import { FilePgModel } from '../models/file';
import { PostgresFileRecord } from '../types/file';
import { getExecutionInfoByGranuleCumulusIds } from '../lib/execution';

const log = new Logger({ sender: '@cumulus/db/GranuleSearch' });

interface GranuleRecord extends BaseRecord, PostgresGranuleRecord {
  collectionName: string,
  collectionVersion: string,
  pdrName?: string,
  providerName?: string,
}

/**
 * Class to build and execute db search query for granules
 */
export class GranuleSearch extends BaseSearch {
  constructor(event: QueryEvent) {
    // estimate the table rowcount by default
    if (event?.queryStringParameters?.estimateTableRowCount !== 'false') {
      set(event, 'queryStringParameters.estimateTableRowCount', 'true');
    }
    super(event, 'granule');
  }

  // temp helper for understanding query performance
  // private async explainAnalyzeQuery(queryBuilder: Knex.QueryBuilder, knex: Knex) {
  //   const sql = queryBuilder.toSQL().sql;
  //   const bindings = queryBuilder.toSQL().bindings;
  
  //   const explainQuery = knex.raw(`EXPLAIN (ANALYZE, BUFFERS) ${sql}`, bindings);
  //   const result = await explainQuery;

  //   const rows: Array<{ [key: string]: any }> = result.rows || result;
  
  //   console.log('--- EXPLAIN ANALYZE OUTPUT ---');
  //   rows.forEach(row => {
  //     console.log(row['QUERY PLAN']);
  //   });
  // }

  /**
   * Build basic query
   *
   * @param knex - DB client
   * @returns queries for getting count and search result
   */
  protected buildBasicQuery(knex: Knex)
    : {
      cteQueryBuilder: Knex.QueryBuilder,
    } {
    const {
      collections: collectionsTable,
      providers: providersTable,
      pdrs: pdrsTable,
    } = TableNames;
  
    const cteQueryBuilder = knex(this.tableName)
      .select(
        `${this.tableName}.*`,
        `${collectionsTable}.name as collectionName`,
        `${collectionsTable}.version as collectionVersion`,
        `${providersTable}.name as providerName`,
        `${pdrsTable}.name as pdrName`,
      )
      .leftJoin(collectionsTable, `${this.tableName}.collection_cumulus_id`, `${collectionsTable}.cumulus_id`)
      .leftJoin(providersTable, `${this.tableName}.provider_cumulus_id`, `${providersTable}.cumulus_id`)
      .leftJoin(pdrsTable, `${this.tableName}.pdr_cumulus_id`, `${pdrsTable}.cumulus_id`)
  
    return { cteQueryBuilder };
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
    cteQueryBuilder: Knex.QueryBuilder,
    dbQueryParameters?: DbQueryParameters,
  }) {
    const { cteQueryBuilder, dbQueryParameters } = params;
    const { infix, prefix } = dbQueryParameters ?? this.dbQueryParameters;
    if (infix) {
      cteQueryBuilder.whereLike(`${this.tableName}.granule_id`, `%${infix}%`);
    }
    if (prefix) {
      cteQueryBuilder.whereLike(`${this.tableName}.granule_id`, `${prefix}%`);
    }
  }

  protected buildJoins(params: { searchQuery: Knex.QueryBuilder; cteName: string }): Knex.QueryBuilder {
    return params.searchQuery;
  }
  

  protected buildTermQuery(params: {
    cteQueryBuilder: Knex.QueryBuilder,
    dbQueryParameters?: DbQueryParameters,
  }) {
    const {
      collections: collectionsTable,
      providers: providersTable,
      pdrs: pdrsTable,
      asyncOperations: asyncOperationsTable,
      executions: executionsTable,
    } = TableNames;

    const { cteQueryBuilder, dbQueryParameters } = params;
    const { term = {} } = dbQueryParameters ?? this.dbQueryParameters;

    Object.entries(term).forEach(([name, value]) => {
      switch (name) {
        case 'collectionName':
          cteQueryBuilder.where(`${collectionsTable}.name`, value);
          break;
        case 'collectionVersion':
          cteQueryBuilder.where(`${collectionsTable}.version`, value);
          break;
        case 'executionArn':
          cteQueryBuilder.where(`${executionsTable}.arn`, value);
          break;
        case 'providerName':
          cteQueryBuilder.where(`${providersTable}.name`, value);
          break;
        case 'pdrName':
          cteQueryBuilder.where(`${pdrsTable}.name`, value);
          break;
        case 'error.Error':
          cteQueryBuilder.whereRaw(`${this.tableName}.error->>'Error' = ?`, value);
          break;
        case 'asyncOperationId':
          cteQueryBuilder.where(`${asyncOperationsTable}.id`, value);
          break;
        case 'parentArn':
          cteQueryBuilder.where(`${executionsTable}.parentArn`, value);
          break;
        default:
          cteQueryBuilder.where(`${this.tableName}.${name}`, value);
          break;
      }
    });
  }
  
  protected buildTermsQuery(params: { cteQueryBuilder: Knex.QueryBuilder; dbQueryParameters?: DbQueryParameters; }) {
  const {
      collections: collectionsTable,
      providers: providersTable,
      pdrs: pdrsTable,
      asyncOperations: asyncOperationsTable,
      executions: executionsTable,
    } = TableNames;

    const { cteQueryBuilder, dbQueryParameters } = params;
    const { terms = {} } = dbQueryParameters ?? this.dbQueryParameters;

    Object.entries(terms).forEach(([name, value]) => {
      switch (name) {
        case 'collectionName':
          cteQueryBuilder.whereIn(`${collectionsTable}.name`, value);
          break;
        case 'collectionVersion':
          cteQueryBuilder.whereIn(`${collectionsTable}.version`, value);
          break;
        case 'executionArn':
          cteQueryBuilder.whereIn(`${executionsTable}.arn`, value);
          break;
        case 'providerName':
          cteQueryBuilder.whereIn(`${providersTable}.name`, value);
          break;
        case 'pdrName':
          cteQueryBuilder.whereIn(`${pdrsTable}.name`, value);
          break;
        case 'error.Error':
          if (Array.isArray(value) && value.length > 0) {
            cteQueryBuilder.whereRaw(
              `${this.tableName}.error->>'Error' IN (${value.map(() => '?').join(',')})`,
              value
            );
          }          
          break;
        case 'asyncOperationId':
          cteQueryBuilder.whereIn(`${asyncOperationsTable}.id`, value);
          break;
        case 'parentArn':
          cteQueryBuilder.whereIn(`${executionsTable}.parentArn`, value);
          break;
        default:
          cteQueryBuilder.whereIn(`${this.tableName}.${name}`, value);
          break;
      }
    });
  }

  protected buildCTETermQuery(params: { knex: Knex, cteQueryBuilders: Record<string, Knex.QueryBuilder>; dbQueryParameters?: DbQueryParameters; }) {
    const {
      collections: collectionsTable,
      providers: providersTable,
      pdrs: pdrsTable,
      asyncOperations: asyncOperationsTable,
      executions: executionsTable,
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
        case 'executionArn':
          cteQueryBuilders[`${executionsTable}`].where(`${executionsTable}.arn`, value);
          break;
        case 'parentArn':
          cteQueryBuilders[`${executionsTable}`].where(`${executionsTable}_parent.arn`, value);
          break;
        case 'providerName':
          cteQueryBuilders[`${providersTable}`].where(`${providersTable}.name`, value);
          break;
        case 'pdrName':
          cteQueryBuilders[`${pdrsTable}`].where(`${pdrsTable}.name`, value);
          break;
        case 'asyncOperationId':
          cteQueryBuilders[`${asyncOperationsTable}`].where(`${asyncOperationsTable}.id`, value);
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

  protected buildCTETermsQuery(params: { knex: Knex; cteQueryBuilders: Record<string, Knex.QueryBuilder>; dbQueryParameters?: DbQueryParameters; }) {
    const {
      collections: collectionsTable,
      providers: providersTable,
      pdrs: pdrsTable,
      asyncOperations: asyncOperationsTable,
      executions: executionsTable,
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
        case 'executionArn':
          cteQueryBuilders[`${executionsTable}`].whereIn(`${executionsTable}.arn`, value);
          break;
        case 'providerName':
          cteQueryBuilders[`${providersTable}`].whereIn(`${providersTable}.name`, value);
          break;
        case 'pdrName':
          cteQueryBuilders[`${pdrsTable}`].whereIn(`${pdrsTable}.name`, value);
          break;
        case 'error.Error':
          if (Array.isArray(value) && value.length > 0) {
            cteQueryBuilders[`${this.tableName}`].whereRaw(
              `${this.tableName}.error->>'Error' IN (${value.map(() => '?').join(',')})`,
              value
            );
          }          
          break;
        case 'asyncOperationId':
          cteQueryBuilders[`${asyncOperationsTable}`].whereIn(`${asyncOperationsTable}.id`, value);
          break;
        case 'parentArn':
          cteQueryBuilders[`${executionsTable}`].whereIn(`${executionsTable}.parentArn`, value);
          break;
        default:
          cteQueryBuilders[`${this.tableName}`].whereIn(`${this.tableName}.${name}`, value);
          break;
      }
    });
  }

  protected buildCTENotMatchQuery(params: { knex: Knex; cteQueryBuilders: Record<string, Knex.QueryBuilder>; dbQueryParameters?: DbQueryParameters; }) {
    const {
      collections: collectionsTable,
      providers: providersTable,
      pdrs: pdrsTable,
      asyncOperations: asyncOperationsTable,
      executions: executionsTable,
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
        case 'executionArn':
          cteQueryBuilders[`${executionsTable}`].whereNot(`${executionsTable}.arn`, value);
          break;
        case 'providerName':
          cteQueryBuilders[`${providersTable}`].whereNot(`${providersTable}.name`, value);
          break;
        case 'pdrName':
          cteQueryBuilders[`${pdrsTable}`].whereNot(`${pdrsTable}.name`, value);
          break;
        case 'error.Error':
          cteQueryBuilders[`${this.tableName}`].whereRaw(`${this.tableName}.error->>'Error' != ?`, value);
          break;
        case 'asyncOperationId':
          cteQueryBuilders[`${asyncOperationsTable}`].whereNot(`${asyncOperationsTable}.id`, value);
          break;
        case 'parentArn':
          cteQueryBuilders[`${executionsTable}`].whereNot(`${executionsTable}.parentArn`, value);
          break;
        default:
          cteQueryBuilders[`${this.tableName}`].whereNot(`${this.tableName}.${name}`, value);
          break;
      }
    });
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
      cteQueryBuilders[`${this.tableName}`].whereLike(`${this.tableName}.granule_id`, `%${infix}%`);
    }
    if (prefix) {
      cteQueryBuilders[`${this.tableName}`].whereLike(`${this.tableName}.granule_id`, `${prefix}%`);
    }
  }

  protected buildCTETables(params: { knex: Knex; cteQueryBuilders: Record<string, Knex.QueryBuilder>; term: any }) {
    const {
      collections: collectionsTable,
      providers: providersTable,
      pdrs: pdrsTable,
      asyncOperations: asyncOperationsTable,
      executions: executionsTable,
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
        case 'executionArn':
        case 'parentArn':
          if (!(`${executionsTable}` in cteQueryBuilders)) {
            cteQueryBuilders[`${executionsTable}`] = knex.select('*').from(`${executionsTable}`);
          }
          break;
        case 'providerName':
          if (!(`${providersTable}` in cteQueryBuilders)) {
            cteQueryBuilders[`${providersTable}`] = knex.select('*').from(`${providersTable}`);
          }
          break;
        case 'pdrName':
          if (!(`${pdrsTable}` in cteQueryBuilders)) {
            cteQueryBuilders[`${pdrsTable}`] = knex.select('*').from(`${pdrsTable}`);
          }
          break;
        case 'asyncOperationId':
          if (!(`${asyncOperationsTable}` in cteQueryBuilders)) {
            cteQueryBuilders[`${asyncOperationsTable}`] = knex.select('*').from(`${asyncOperationsTable}`);
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
  }

  protected joinCTESearchTables(params: {
    cteSearchQueryBuilder: Knex.QueryBuilder;
    cteQueryBuilders: Record<string, Knex.QueryBuilder>;
  }) {
    const {
      collections: collectionsTable,
      providers: providersTable,
      pdrs: pdrsTable,
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
      cteSearchQueryBuilder.innerJoin(`${collectionsTable}_cte`, `${mainTableName}.collection_cumulus_id`, `${collectionsTable}_cte.cumulus_id`);
    } else {
      cteSearchQueryBuilder.leftJoin(`${collectionsTable}`, `${mainTableName}.collection_cumulus_id`, `${collectionsTable}.cumulus_id`);
    }
    let providersTableName = `${providersTable}`;
    if (`${providersTable}` in cteQueryBuilders) {
      providersTableName = `${providersTable}_cte`;
      cteSearchQueryBuilder.innerJoin(`${providersTable}_cte`, `${mainTableName}.provider_cumulus_id`, `${providersTable}_cte.cumulus_id`);
    } else {
      cteSearchQueryBuilder.leftJoin(`${providersTable}`, `${mainTableName}.provider_cumulus_id`, `${providersTable}.cumulus_id`);
    }
    let pdrsTableName = `${pdrsTable}`;
    if (`${pdrsTable}` in cteQueryBuilders) {
      pdrsTableName = `${pdrsTable}_cte`;
      cteSearchQueryBuilder.innerJoin(`${pdrsTable}_cte`, `${mainTableName}.pdr_cumulus_id`, `${pdrsTable}_cte.cumulus_id`);
    } else {
      cteSearchQueryBuilder.leftJoin(`${pdrsTable}`, `${mainTableName}.pdr_cumulus_id`, `${pdrsTable}.cumulus_id`);
    }    
    cteSearchQueryBuilder.select(
      `${mainTableName}.*`,
      `${collectionsTableName}.name as collectionName`,
      `${collectionsTableName}.version as collectionVersion`,
      `${providersTableName}.name as providerName`,
      `${pdrsTableName}.name as pdrName`
    );

    return cteSearchQueryBuilder;
  }

  protected joinCTECountTables(params: {
    cteCountQueryBuilder: Knex.QueryBuilder;
    cteQueryBuilders: Record<string, Knex.QueryBuilder>;
  }) {
    const {
      collections: collectionsTable,
      providers: providersTable,
      pdrs: pdrsTable,
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
    if (`${collectionsTable}` in cteQueryBuilders) {
      cteCountQueryBuilder.innerJoin(`${collectionsTable}_cte`, `${mainTableName}.collection_cumulus_id`, `${collectionsTable}_cte.cumulus_id`);
    } else {
      cteCountQueryBuilder.leftJoin(`${collectionsTable}`, `${mainTableName}.collection_cumulus_id`, `${collectionsTable}.cumulus_id`);
    }
    if (`${providersTable}` in cteQueryBuilders) {
      cteCountQueryBuilder.innerJoin(`${providersTable}_cte`, `${mainTableName}.provider_cumulus_id`, `${providersTable}_cte.cumulus_id`);
    } else {
      cteCountQueryBuilder.leftJoin(`${providersTable}`, `${mainTableName}.provider_cumulus_id`, `${providersTable}.cumulus_id`);
    }    
    if (`${pdrsTable}` in cteQueryBuilders) {
      cteCountQueryBuilder.innerJoin(`${pdrsTable}_cte`, `${mainTableName}.pdr_cumulus_id`, `${pdrsTable}_cte.cumulus_id`);
    } else {
      cteCountQueryBuilder.leftJoin(`${pdrsTable}`, `${mainTableName}.pdr_cumulus_id`, `${pdrsTable}.cumulus_id`);
    }    
    cteCountQueryBuilder.countDistinct(
      `${mainTableName}.cumulus_id as count`
    );

    return cteCountQueryBuilder;
  }  

  /**
     * Build queries for sort keys and fields
     *
     * @param params
     * @param params.searchQuery - query builder for search
     * @param [params.dbQueryParameters] - db query parameters
     */
  protected buildCTESortQuery(params: {
    searchQuery: Knex.QueryBuilder,
    dbQueryParameters?: DbQueryParameters,
    //cteQueryBuilders: Record<string, Knex.QueryBuilder>
  }) {
    const { searchQuery, dbQueryParameters } = params;
    const { sort } = dbQueryParameters || this.dbQueryParameters;
    // const table = cteName || this.tableName;
    sort?.forEach((key) => {
      log.debug(`sort key ${JSON.stringify(key)}`);
      if (key.column.startsWith('error')) {
        searchQuery.orderByRaw(
          `${this.tableName}_cte.error ->> 'Error' ${key.order}`
        );
      } else if (dbQueryParameters?.collate) {
        searchQuery.orderByRaw(
          `${key} collate \"${dbQueryParameters.collate}\"`
        );
      } else {
        searchQuery.orderBy([key]);
      }
    });
  }

  protected buildNotMatchQuery(params: { cteQueryBuilder: Knex.QueryBuilder; dbQueryParameters?: DbQueryParameters; }) {
    const {
      collections: collectionsTable,
      providers: providersTable,
      pdrs: pdrsTable,
      asyncOperations: asyncOperationsTable,
      executions: executionsTable,
    } = TableNames;

    const { cteQueryBuilder, dbQueryParameters } = params;
    const { not: term = {} } = dbQueryParameters ?? this.dbQueryParameters;

    Object.entries(term).forEach(([name, value]) => {
      switch (name) {
        case 'collectionName':
          cteQueryBuilder.whereNot(`${collectionsTable}.name`, value);
          break;
        case 'collectionVersion':
          cteQueryBuilder.whereNot(`${collectionsTable}.version`, value);
          break;
        case 'executionArn':
          cteQueryBuilder.whereNot(`${executionsTable}.arn`, value);
          break;
        case 'providerName':
          cteQueryBuilder.whereNot(`${providersTable}.name`, value);
          break;
        case 'pdrName':
          cteQueryBuilder.whereNot(`${pdrsTable}.name`, value);
          break;
        case 'error.Error':
          cteQueryBuilder.whereRaw(`${this.tableName}.error->>'Error' != ?`, value);
          break;
        case 'asyncOperationId':
          cteQueryBuilder.whereNot(`${asyncOperationsTable}.id`, value);
          break;
        case 'parentArn':
          cteQueryBuilder.whereNot(`${executionsTable}.parentArn`, value);
          break;
        default:
          cteQueryBuilder.whereNot(`${this.tableName}.${name}`, value);
          break;
      }
    });
  }

  /**
   * Build the search query for active collections.
   * If time params are specified the query will search granules that have been updated
   * in that time frame.  If granuleId or providerId are provided, it will filter those as well.
   *
   * @param knex - DB client
   * @returns queries for getting count and search result
   */
  public buildSearchForActiveCollections(knex: Knex)
    : {
      countQuery: Knex.QueryBuilder,
      searchQuery: Knex.QueryBuilder,
    } {
    const { cteQueryBuilder } = this.buildBasicQuery(knex);
  
    this.buildTermQuery({ cteQueryBuilder });
    this.buildTermsQuery({ cteQueryBuilder });
    this.buildRangeQuery({ knex, cteQueryBuilder });
  
    const cteName = `${this.tableName}_cte`;
    const baseCTE = knex.with(cteName, cteQueryBuilder);
  
    const searchQuery = this.buildJoins({
      searchQuery: baseCTE.select(`${cteName}.*`),
      cteName,
    });
    
    const countQuery = baseCTE.countDistinct(`${cteName}.cumulus_id as count`);

    this.buildSortQuery({ searchQuery, cteName });
  
    const { limit, offset } = this.dbQueryParameters;
    if (limit) searchQuery.limit(limit);
    if (offset) searchQuery.offset(offset);
  
    log.debug(`buildSearchForActiveCollections returns countQuery: ${countQuery?.toSQL().sql}, searchQuery: ${searchQuery.toSQL().sql}`);
    return { countQuery, searchQuery };
  }

  protected buildSearch(knex: Knex) {
    const { cteQueryBuilder } = this.buildBasicQuery(knex);
    this.buildTermQuery({ cteQueryBuilder });
    this.buildTermsQuery({ cteQueryBuilder });
    this.buildNotMatchQuery({ cteQueryBuilder });
    this.buildRangeQuery({ knex, cteQueryBuilder });
    this.buildExistsQuery({ cteQueryBuilder });
    this.buildInfixPrefixQuery({ cteQueryBuilder });

    const cteName = `${this.tableName}_cte`;
  
    let searchQuery = knex.with(cteName, cteQueryBuilder)
      .select(`${cteName}.*`)
      .from(cteName);
  
    this.buildJoins({ searchQuery, cteName });
  
    let countQuery = knex.with(cteName, cteQueryBuilder)
      .from(cteName)
      .countDistinct(`${cteName}.cumulus_id as count`);
  
    this.buildSortQuery({ searchQuery, cteName });
  
    if (this.dbQueryParameters.limit) searchQuery.limit(this.dbQueryParameters.limit);
    if (this.dbQueryParameters.offset) searchQuery.offset(this.dbQueryParameters.offset);

    const cteQueryBuilders = {};
    this.buildCTETermQuery({ knex, cteQueryBuilders });
    this.buildCTETermsQuery({ knex, cteQueryBuilders });
    this.buildCTENotMatchQuery({ knex, cteQueryBuilders });
    this.buildCTERangeQuery({ knex, cteQueryBuilders });
    this.buildCTEExistsQuery({ knex, cteQueryBuilders });
    this.buildCTEInfixPrefixQuery({ knex, cteQueryBuilders });
    const cteSearchQueryBuilder = knex.queryBuilder();
    searchQuery = this.joinCTESearchTables({ cteSearchQueryBuilder, cteQueryBuilders });
    const cteCountQueryBuilder = knex.queryBuilder();
    countQuery = this.joinCTECountTables({ cteCountQueryBuilder, cteQueryBuilders });
    this.buildCTESortQuery({ searchQuery });
    if (this.dbQueryParameters.limit) searchQuery.limit(this.dbQueryParameters.limit);
    if (this.dbQueryParameters.offset) searchQuery.offset(this.dbQueryParameters.offset);
    
    log.debug(`buildSearch returns countQuery: ${countQuery?.toSQL().sql}, searchQuery: ${searchQuery.toSQL().sql}`);
    return { countQuery, searchQuery };
  }

  /**
   * Translate postgres records to api records
   *
   * @param pgRecords - postgres records returned from query
   * @param knex - DB client
   * @returns translated api records
   */
  protected async translatePostgresRecordsToApiRecords(pgRecords: GranuleRecord[], knex: Knex)
    : Promise<Partial<ApiGranuleRecord>[]> {
    log.debug(`translatePostgresRecordsToApiRecords number of records ${pgRecords.length} `);

    const { fields, includeFullRecord } = this.dbQueryParameters;

    const fileMapping: { [key: number]: PostgresFileRecord[] } = {};
    const executionMapping: { [key: number]: { url: string, granule_cumulus_id: number } } = {};
    const cumulusIds = pgRecords.map((record) => record.cumulus_id);
    if (includeFullRecord) {
      //get Files
      const fileModel = new FilePgModel();
      const files = await fileModel.searchByGranuleCumulusIds(knex, cumulusIds);
      files.forEach((file) => {
        if (!(file.granule_cumulus_id in fileMapping)) {
          fileMapping[file.granule_cumulus_id] = [];
        }
        fileMapping[file.granule_cumulus_id].push(file);
      });

      //get Executions
      const executions = await getExecutionInfoByGranuleCumulusIds({
        knexOrTransaction: knex,
        granuleCumulusIds: cumulusIds,
      });
      executions.forEach((execution) => {
        if (!(execution.granule_cumulus_id in executionMapping)) {
          executionMapping[execution.granule_cumulus_id] = execution;
        }
      });
    }
    const apiRecords = pgRecords.map((item: GranuleRecord) => {
      const granulePgRecord = item;
      const collectionPgRecord = {
        cumulus_id: item.collection_cumulus_id,
        name: item.collectionName,
        version: item.collectionVersion,
      };
      const executionUrls = executionMapping[item.cumulus_id]?.url
        ? [{ url: executionMapping[item.cumulus_id].url }]
        : [];
      const pdr = item.pdrName ? { name: item.pdrName } : undefined;
      const providerPgRecord = item.providerName ? { name: item.providerName } : undefined;
      const fileRecords = fileMapping[granulePgRecord.cumulus_id] || [];
      const apiRecord = translatePostgresGranuleToApiGranuleWithoutDbQuery({
        granulePgRecord,
        collectionPgRecord,
        pdr,
        providerPgRecord,
        files: fileRecords,
        executionUrls,
      });
      return fields ? pick(apiRecord, fields) : apiRecord;
    });
    return apiRecords;
  }
}
