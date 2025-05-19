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
    const { countQuery, searchQuery } = super.buildCteSearch(knex);
    return { countQuery, searchQuery };
  }

  /**
   * @param params
   * @param params.knex - DB client
   * @param params.cteQueryBuilders - object of query builders
   * @param [params.dbQueryParameters] - db query parameters
   */
  protected buildCteTermQuery(params: {
    knex: Knex,
    cteQueryBuilders: Record<string, Knex.QueryBuilder>,
    dbQueryParameters?: DbQueryParameters,
  }) {
    const {
      collections: collectionsTable,
      providers: providersTable,
      pdrs: pdrsTable,
      asyncOperations: asyncOperationsTable,
      executions: executionsTable,
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

  /**
   * @param params
   * @param params.knex - DB client
   * @param params.cteQueryBuilders - object of query builders
   * @param [params.dbQueryParameters] - db query parameters
   */
  protected buildCteTermsQuery(params: {
    knex: Knex;
    cteQueryBuilders: Record<string, Knex.QueryBuilder>,
    dbQueryParameters?: DbQueryParameters,
  }) {
    const {
      collections: collectionsTable,
      providers: providersTable,
      pdrs: pdrsTable,
      asyncOperations: asyncOperationsTable,
      executions: executionsTable,
    } = TableNames;

    const { knex, cteQueryBuilders, dbQueryParameters } = params;
    const { terms = {} } = dbQueryParameters ?? this.dbQueryParameters;
    this.buildCteTables({ knex, cteQueryBuilders, term: terms });

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

  /**
   * @param params
   * @param params.knex - DB client
   * @param params.cteQueryBuilders - object of query builders
   * @param [params.dbQueryParameters] - db query parameters
   */
  protected buildCteNotMatchQuery(params: {
    knex: Knex,
    cteQueryBuilders: Record<string, Knex.QueryBuilder>,
    dbQueryParameters?: DbQueryParameters
  }) {
    const {
      collections: collectionsTable,
      providers: providersTable,
      pdrs: pdrsTable,
      asyncOperations: asyncOperationsTable,
      executions: executionsTable,
    } = TableNames;

    const { knex, cteQueryBuilders, dbQueryParameters } = params;
    const { not: term = {} } = dbQueryParameters ?? this.dbQueryParameters;
    this.buildCteTables({ knex, cteQueryBuilders, term });

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

  /**
   * @param params
   * @param params.cteQueryBuilder - query builder
   * @param [params.dbQueryParameters] - db query parameters
   * @param [params.cteName] - main common table expression name
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
      cteQueryBuilder.whereLike(`${table}.granule_id`, `%${infix}%`);
    }
    if (prefix) {
      cteQueryBuilder.whereLike(`${table}.granule_id`, `${prefix}%`);
    }
  }

  /**
   * @param params
   * @param params.cteSearchQueryBuilder - query builder
   * @param params.cteQueryBuilders - object that holds query builders
   * @returns - search query builder
   */
  protected joinCteTables(params: {
    cteSearchQueryBuilder: Knex.QueryBuilder;
    cteQueryBuilders: Record<string, Knex.QueryBuilder>;
  })
    : {
      cteSearchQueryBuilder: Knex.QueryBuilder
    } {
    const {
      collections: collectionsTable,
      providers: providersTable,
      pdrs: pdrsTable,
    } = TableNames;

    const { cteSearchQueryBuilder, cteQueryBuilders } = params;
    Object.entries(cteQueryBuilders).forEach(([tableName, cteQuery]) => {
      cteSearchQueryBuilder.with(`${tableName}_cte`, cteQuery);
    });

    const mainTableName = `${this.tableName}_cte`;
    cteSearchQueryBuilder.from(`${mainTableName}`);
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

    return { cteSearchQueryBuilder };
  }

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
        `${pdrsTable}.name as pdrsName`
      )
      .innerJoin(collectionsTable, `${this.tableName}.collection_cumulus_id`, `${collectionsTable}.cumulus_id`);
    if (this.searchProvider()) {
      cteQueryBuilder.innerJoin(providersTable, `${this.tableName}.provider_cumulus_id`, `${providersTable}.cumulus_id`);
    } else {
      cteQueryBuilder.leftJoin(providersTable, `${this.tableName}.provider_cumulus_id`, `${providersTable}.cumulus_id`);
    }
    if (this.searchPdr()) {
      cteQueryBuilder.innerJoin(pdrsTable, `${this.tableName}.pdr_cumulus_id`, `${pdrsTable}.cumulus_id`);
    } else {
      cteQueryBuilder.leftJoin(pdrsTable, `${this.tableName}.pdr_cumulus_id`, `${pdrsTable}.cumulus_id`);
    }

    return { cteQueryBuilder };
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
    //const cteName = `${this.tableName}_cte`;

    const searchQuery = cteQueryBuilder;

    const countQuery = cteQueryBuilder;

    log.debug(`buildSearchForActiveCollections returns countQuery: ${countQuery?.toSQL().sql}, searchQuery: ${searchQuery.toSQL().sql}`);
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
