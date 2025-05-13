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

  protected buildTermQuery(params: {
    knex?: Knex,
    cteQueryBuilder: Record<string, Knex.QueryBuilder>,
    dbQueryParameters?: DbQueryParameters,
  }) {
    const {
      collections: collectionsTable,
      providers: providersTable,
      pdrs: pdrsTable,
      asyncOperations: asyncOperationsTable,
      executions: executionsTable,
    } = TableNames;

    const { knex, cteQueryBuilder, dbQueryParameters } = params;
    const { term = {} } = dbQueryParameters ?? this.dbQueryParameters;

    if (knex) this.buildCTETables({ knex, cteQueryBuilders: cteQueryBuilder, term });

    Object.entries(term).forEach(([name, value]) => {
      switch (name) {
        case 'collectionName':
          cteQueryBuilder[`${collectionsTable}`].where(`${collectionsTable}.name`, value);
          break;
        case 'collectionVersion':
          cteQueryBuilder[`${collectionsTable}`].where(`${collectionsTable}.version`, value);
          break;
        case 'executionArn':
          cteQueryBuilder[`${executionsTable}`].where(`${executionsTable}.arn`, value);
          break;
        case 'parentArn':
          cteQueryBuilder[`${executionsTable}`].where(`${executionsTable}_parent.arn`, value);
          break;
        case 'providerName':
          cteQueryBuilder[`${providersTable}`].where(`${providersTable}.name`, value);
          break;
        case 'pdrName':
          cteQueryBuilder[`${pdrsTable}`].where(`${pdrsTable}.name`, value);
          break;
        case 'asyncOperationId':
          cteQueryBuilder[`${asyncOperationsTable}`].where(`${asyncOperationsTable}.id`, value);
          break;
        case 'error.Error':
          cteQueryBuilder[`${this.tableName}`].whereRaw(`${this.tableName}.error->>'Error' = ?`, value);
          break;
        default:
          cteQueryBuilder[`${this.tableName}`].where(`${this.tableName}.${name}`, value);
          break;
      }
    });
  }

  protected buildTermsQuery(params: {
    knex?: Knex,
    cteQueryBuilder: Record<string, Knex.QueryBuilder>,
    dbQueryParameters?: DbQueryParameters,
  }) {
    const {
      collections: collectionsTable,
      providers: providersTable,
      pdrs: pdrsTable,
      asyncOperations: asyncOperationsTable,
      executions: executionsTable,
    } = TableNames;

    const { knex, cteQueryBuilder, dbQueryParameters } = params;
    const { terms = {} } = dbQueryParameters ?? this.dbQueryParameters;
    if (knex) this.buildCTETables({ knex, cteQueryBuilders: cteQueryBuilder, term: terms });

    Object.entries(terms).forEach(([name, value]) => {
      switch (name) {
        case 'collectionName':
          cteQueryBuilder[`${collectionsTable}`].whereIn(`${collectionsTable}.name`, value);
          break;
        case 'collectionVersion':
          cteQueryBuilder[`${collectionsTable}`].whereIn(`${collectionsTable}.version`, value);
          break;
        case 'executionArn':
          cteQueryBuilder[`${executionsTable}`].whereIn(`${executionsTable}.arn`, value);
          break;
        case 'providerName':
          cteQueryBuilder[`${providersTable}`].whereIn(`${providersTable}.name`, value);
          break;
        case 'pdrName':
          cteQueryBuilder[`${pdrsTable}`].whereIn(`${pdrsTable}.name`, value);
          break;
        case 'error.Error':
          if (Array.isArray(value) && value.length > 0) {
            cteQueryBuilder[`${this.tableName}`].whereRaw(
              `${this.tableName}.error->>'Error' IN (${value.map(() => '?').join(',')})`,
              value
            );
          }
          break;
        case 'asyncOperationId':
          cteQueryBuilder[`${asyncOperationsTable}`].whereIn(`${asyncOperationsTable}.id`, value);
          break;
        case 'parentArn':
          cteQueryBuilder[`${executionsTable}`].whereIn(`${executionsTable}.parentArn`, value);
          break;
        default:
          cteQueryBuilder[`${this.tableName}`].whereIn(`${this.tableName}.${name}`, value);
          break;
      }
    });
  }

  protected buildNotMatchQuery(params: {
    knex?: Knex,
    cteQueryBuilder: Record<string, Knex.QueryBuilder>,
    dbQueryParameters?: DbQueryParameters
  }) {
    const {
      collections: collectionsTable,
      providers: providersTable,
      pdrs: pdrsTable,
      asyncOperations: asyncOperationsTable,
      executions: executionsTable,
    } = TableNames;

    const { knex, cteQueryBuilder, dbQueryParameters } = params;
    const { not: term = {} } = dbQueryParameters ?? this.dbQueryParameters;
    if (knex) this.buildCTETables({ knex, cteQueryBuilders: cteQueryBuilder, term });

    Object.entries(term).forEach(([name, value]) => {
      switch (name) {
        case 'collectionName':
          cteQueryBuilder[`${collectionsTable}`].whereNot(`${collectionsTable}.name`, value);
          break;
        case 'collectionVersion':
          cteQueryBuilder[`${collectionsTable}`].whereNot(`${collectionsTable}.version`, value);
          break;
        case 'executionArn':
          cteQueryBuilder[`${executionsTable}`].whereNot(`${executionsTable}.arn`, value);
          break;
        case 'providerName':
          cteQueryBuilder[`${providersTable}`].whereNot(`${providersTable}.name`, value);
          break;
        case 'pdrName':
          cteQueryBuilder[`${pdrsTable}`].whereNot(`${pdrsTable}.name`, value);
          break;
        case 'error.Error':
          cteQueryBuilder[`${this.tableName}`].whereRaw(`${this.tableName}.error->>'Error' != ?`, value);
          break;
        case 'asyncOperationId':
          cteQueryBuilder[`${asyncOperationsTable}`].whereNot(`${asyncOperationsTable}.id`, value);
          break;
        case 'parentArn':
          cteQueryBuilder[`${executionsTable}`].whereNot(`${executionsTable}.parentArn`, value);
          break;
        default:
          cteQueryBuilder[`${this.tableName}`].whereNot(`${this.tableName}.${name}`, value);
          break;
      }
    });
  }

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

  protected buildCTETables(params: {
    knex: Knex,
    cteQueryBuilders: Record<string, Knex.QueryBuilder>,
    term: any
  }) {
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
          this.initCteTable({ knex, cteQueryBuilders, cteName: collectionsTable });
          break;
        case 'executionArn':
        case 'parentArn':
          this.initCteTable({ knex, cteQueryBuilders, cteName: executionsTable });
          break;
        case 'providerName':
          this.initCteTable({ knex, cteQueryBuilders, cteName: providersTable });
          break;
        case 'pdrName':
          this.initCteTable({ knex, cteQueryBuilders, cteName: pdrsTable });
          break;
        case 'asyncOperationId':
          this.initCteTable({ knex, cteQueryBuilders, cteName: asyncOperationsTable });
          break;
        case 'error.Error':
        default:
          this.initCteTable({ knex, cteQueryBuilders, cteName: this.tableName });
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
    const cteQueryBuilders : Record<string, Knex.QueryBuilder> = {};
    this.initCteTable({ knex, cteQueryBuilders, cteName: this.tableName });
    this.buildTermQuery({ knex, cteQueryBuilder: cteQueryBuilders });
    this.buildTermsQuery({ knex, cteQueryBuilder: cteQueryBuilders });
    this.buildRangeQuery({ knex, cteQueryBuilder: cteQueryBuilders[`${this.tableName}`] });
    const cteSearchQueryBuilder = knex.queryBuilder();
    const searchQuery = this.joinCTESearchTables({ cteSearchQueryBuilder, cteQueryBuilders });
    const cteCountQueryBuilder = knex.queryBuilder();
    const countQuery = this.joinCTECountTables({ cteCountQueryBuilder, cteQueryBuilders });
    this.buildSortQuery({ searchQuery, cteName: `${this.tableName}_cte` });
    const { limit, offset } = this.dbQueryParameters;
    if (limit) searchQuery.limit(limit);
    if (offset) searchQuery.offset(offset);

    log.debug(`buildSearchForActiveCollections returns countQuery: ${countQuery?.toSQL().sql}, searchQuery: ${searchQuery.toSQL().sql}`);
    return { countQuery, searchQuery };
  }

  protected initCteTable(params: {
    knex: Knex,
    cteQueryBuilders: Record<string, Knex.QueryBuilder>,
    cteName: string,
  }) {
    const { knex, cteQueryBuilders, cteName } = params;
    if (!(`${cteName}` in cteQueryBuilders)) cteQueryBuilders[`${cteName}`] = knex.select('*').from(`${cteName}`);
  }

  protected buildCTEExistsQuery(params: {
    cteQueryBuilders: Record<string, Knex.QueryBuilder>
  }) {
    const { cteQueryBuilders } = params;
    this.buildExistsQuery({ cteQueryBuilder: cteQueryBuilders[this.tableName] });
  }

  protected buildSearch(knex: Knex) {
    const cteQueryBuilders : Record<string, Knex.QueryBuilder> = {};
    this.initCteTable({ knex, cteQueryBuilders, cteName: this.tableName });
    this.buildTermQuery({ knex, cteQueryBuilder: cteQueryBuilders });
    this.buildTermsQuery({ knex, cteQueryBuilder: cteQueryBuilders });
    this.buildNotMatchQuery({ knex, cteQueryBuilder: cteQueryBuilders });
    this.buildRangeQuery({ knex, cteQueryBuilder: cteQueryBuilders[`${this.tableName}`] });
    this.buildCTEExistsQuery({ cteQueryBuilders });
    this.buildInfixPrefixQuery({ cteQueryBuilder: cteQueryBuilders[`${this.tableName}`], cteName: `${this.tableName}` });
    const cteSearchQueryBuilder = knex.queryBuilder();
    const searchQuery = this.joinCTESearchTables({ cteSearchQueryBuilder, cteQueryBuilders });
    const cteCountQueryBuilder = knex.queryBuilder();
    const countQuery = this.joinCTECountTables({ cteCountQueryBuilder, cteQueryBuilders });
    this.buildSortQuery({ searchQuery, cteName: `${this.tableName}_cte` });
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
