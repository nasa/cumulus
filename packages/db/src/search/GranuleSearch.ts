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
  protected buildSearch(knex: Knex): {
    countQuery?: Knex.QueryBuilder,
    searchQuery: Knex.QueryBuilder,
  } {
    const {
      collections: collectionsTable,
      providers: providersTable,
      pdrs: pdrsTable,
    } = TableNames;
    const { countQuery, searchQuery } = super.buildCteSearch(knex);
    if (this.searchCollection()) {
      countQuery.innerJoin(collectionsTable, `${this.tableName}.collection_cumulus_id`, `${collectionsTable}.cumulus_id`);
    }

    if (this.searchProvider()) {
      countQuery.innerJoin(providersTable, `${this.tableName}.provider_cumulus_id`, `${providersTable}.cumulus_id`);
    }

    if (this.searchPdr()) {
      countQuery.innerJoin(pdrsTable, `${this.tableName}.pdr_cumulus_id`, `${pdrsTable}.cumulus_id`);
    }
    return { countQuery, searchQuery };
  }

  /**
   * Build the CTE Term query for term search
   *
   * @param params
   * @param params.countQuery - count query
   * @param params.knex - DB client
   * @param params.cteQueryBuilders - object of query builders
   * @param [params.dbQueryParameters] - db query parameters
   */
  protected buildCteTableTermQuery(params: {
    countQuery: Knex.QueryBuilder,
    knex: Knex,
    cteQueryBuilders: Record<string, Knex.QueryBuilder>,
    dbQueryParameters?: DbQueryParameters,
  }) {
    super.buildCteTermQuery({ ...params });
  }

  /**
   * Builds the CTE Terms query for terms search
   *
   * @param params
   * @param params.countQuery - count query
   * @param params.knex - DB client
   * @param params.cteQueryBuilders - object of query builders
   * @param [params.dbQueryParameters] - db query parameters
   */
  protected buildCteTableTermsQuery(params: {
    countQuery: Knex.QueryBuilder,
    knex: Knex;
    cteQueryBuilders: Record<string, Knex.QueryBuilder>,
    dbQueryParameters?: DbQueryParameters,
  }) {
    super.buildCteTermsQuery({ isExecution: false, ...params });
  }

  /**
   * Builds the CTE Not Match query for not match queries
   *
   * @param params
   * @param params.countQuery - count query
   * @param params.knex - DB client
   * @param params.cteQueryBuilders - object of query builders
   * @param [params.dbQueryParameters] - db query parameters
   */
  protected buildCteTableNotMatchQuery(params: {
    countQuery: Knex.QueryBuilder,
    knex: Knex,
    cteQueryBuilders: Record<string, Knex.QueryBuilder>,
    dbQueryParameters?: DbQueryParameters
  }) {
    super.buildCteNotMatchQuery({ isExecution: false, ...params });
  }

  /**
   * Build queries for infix and prefix
   *
   * @param params
   * @param params.cteQueryBuilder - search query builder
   * @param [params.countQuery] - count query
   * @param [params.dbQueryParameters] - db query parameters
   */
  protected buildInfixPrefixQuery(params: {
    cteQueryBuilder: Knex.QueryBuilder,
    countQuery?: Knex.QueryBuilder,
    dbQueryParameters?: DbQueryParameters,
  }) {
    const { countQuery, cteQueryBuilder, dbQueryParameters } = params;
    const { infix, prefix } = dbQueryParameters ?? this.dbQueryParameters;
    if (infix) {
      [countQuery, cteQueryBuilder].forEach((query) => query?.whereLike(`${this.tableName}.granule_id`, `%${infix}%`));
    }
    if (prefix) {
      [countQuery, cteQueryBuilder].forEach((query) => query?.whereLike(`${this.tableName}.granule_id`, `%${prefix}%`));
    }
  }

  /**
   * Joins the tables for the CTE query
   *
   * @param params
   * @param params.knex - DB client
   * @param params.cteSearchQueryBuilder - query builder
   * @param params.cteQueryBuilders - object that holds query builders
   * @returns - search query builder
   */
  protected joinCteTables(params: {
    knex: Knex,
    cteSearchQueryBuilder: Knex.QueryBuilder;
    cteQueryBuilders: Record<string, Knex.QueryBuilder>;
  }): { searchQuery: Knex.QueryBuilder } {
    const {
      collections: collectionsTable,
      providers: providersTable,
      pdrs: pdrsTable,
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

    if (this.dbQueryParameters.limit) cteSearchQueryBuilder.limit(this.dbQueryParameters.limit);
    if (this.dbQueryParameters.offset) cteSearchQueryBuilder.offset(this.dbQueryParameters.offset);

    const searchQuery = knex.with(`${this.tableName}_cte`, cteSearchQueryBuilder).select('*').from(`${this.tableName}_cte`);

    return { searchQuery };
  }

  /**
   * Build basic query
   *
   * @param knex - DB client
   * @returns queries for getting count and search result
   */
  protected buildBasicQuery(knex: Knex): {
    countQuery: Knex.QueryBuilder,
    cteQueryBuilder: Knex.QueryBuilder,
  } {
    const {
      collections: collectionsTable,
      providers: providersTable,
      pdrs: pdrsTable,
    } = TableNames;

    const countQuery = knex(this.tableName)
      .count('*');

    const cteQueryBuilder = knex(this.tableName)
      .select(
        `${this.tableName}.*`,
        `${collectionsTable}.name as collectionName`,
        `${collectionsTable}.version as collectionVersion`,
        `${providersTable}.name as providerName`,
        `${pdrsTable}.name as pdrsName`
      )
      .innerJoin(collectionsTable, `${this.tableName}.collection_cumulus_id`, `${collectionsTable}.cumulus_id`);

    if (this.searchCollection()) {
      countQuery.innerJoin(collectionsTable, `${this.tableName}.collection_cumulus_id`, `${collectionsTable}.cumulus_id`);
    }

    if (this.searchProvider()) {
      countQuery.innerJoin(providersTable, `${this.tableName}.provider_cumulus_id`, `${providersTable}.cumulus_id`);
    }

    if (this.searchPdr()) {
      countQuery.innerJoin(pdrsTable, `${this.tableName}.pdr_cumulus_id`, `${pdrsTable}.cumulus_id`);
    }
    return { countQuery, cteQueryBuilder };
  }

  /**
   * Build the search query for active collections.
   * If time params are specified the query will search granules that have been updated
   * in that time frame.  If granuleId or providerId are provided, it will filter those as well.
   *
   * @param knex - DB client
   * @returns queries for getting count and search result
   */
  public buildSearchForActiveCollections(knex: Knex): {
    countQuery: Knex.QueryBuilder,
    searchQuery: Knex.QueryBuilder,
  } {
    const { countQuery, cteQueryBuilder } = this.buildBasicQuery(knex);
    this.buildTermQuery({ countQuery, cteQueryBuilder });
    this.buildTermsQuery({ countQuery, cteQueryBuilder });
    this.buildRangeQuery({ knex, countQuery, cteQueryBuilder });

    const searchQuery = cteQueryBuilder;

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
