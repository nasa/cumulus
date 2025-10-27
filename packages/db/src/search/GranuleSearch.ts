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
  state?: string,
  groupId?: number,
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
    const {
      collections: collectionsTable,
      providers: providersTable,
      pdrs: pdrsTable,
      granuleGroups: granuleGroupsTable
    } = TableNames;
    const countQuery = knex(this.tableName)
      .count('*');

    const searchQuery = knex(this.tableName)
      .select(`${this.tableName}.*`)
      .select({
        providerName: `${providersTable}.name`,
        collectionName: `${collectionsTable}.name`,
        collectionVersion: `${collectionsTable}.version`,
        pdrName: `${pdrsTable}.name`,
        groupId: `${granuleGroupsTable}.group_id`,
        state: `${granuleGroupsTable}.state`,
      })
      .innerJoin(collectionsTable, `${this.tableName}.collection_cumulus_id`, `${collectionsTable}.cumulus_id`);

    if (this.searchCollection()) {
      countQuery.innerJoin(collectionsTable, `${this.tableName}.collection_cumulus_id`, `${collectionsTable}.cumulus_id`);
    }

    if (this.searchProvider()) {
      countQuery.innerJoin(providersTable, `${this.tableName}.provider_cumulus_id`, `${providersTable}.cumulus_id`);
      searchQuery.innerJoin(providersTable, `${this.tableName}.provider_cumulus_id`, `${providersTable}.cumulus_id`);
    } else {
      searchQuery.leftJoin(providersTable, `${this.tableName}.provider_cumulus_id`, `${providersTable}.cumulus_id`);
    }

    if (this.searchPdr()) {
      countQuery.innerJoin(pdrsTable, `${this.tableName}.pdr_cumulus_id`, `${pdrsTable}.cumulus_id`);
      searchQuery.innerJoin(pdrsTable, `${this.tableName}.pdr_cumulus_id`, `${pdrsTable}.cumulus_id`);
    } else {
      searchQuery.leftJoin(pdrsTable, `${this.tableName}.pdr_cumulus_id`, `${pdrsTable}.cumulus_id`);
    }

    if(this.dbQueryParameters.includeActiveStatus){
      searchQuery.innerJoin(granuleGroupsTable, `${this.tableName}.cumulus_id`, `${granuleGroupsTable}.granule_cumulus_id`)
    } else {
      searchQuery.leftJoin(granuleGroupsTable, `${this.tableName}.cumulus_id`, `${granuleGroupsTable}.granule_cumulus_id`)
    }
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
      [countQuery, searchQuery].forEach((query) => query.whereLike(`${this.tableName}.granule_id`, `%${infix}%`));
    }
    if (prefix) {
      [countQuery, searchQuery].forEach((query) => query.whereLike(`${this.tableName}.granule_id`, `${prefix}%`));
    }
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
    const { countQuery, searchQuery } = this.buildBasicQuery(knex);
    this.buildTermQuery({ countQuery, searchQuery });
    this.buildTermsQuery({ countQuery, searchQuery });
    this.buildRangeQuery({ knex, countQuery, searchQuery });

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
      const granuleGroupRecord = item.state && item.groupId ? { state: item.state, group_id: item.groupId} : undefined;
      const apiRecord = translatePostgresGranuleToApiGranuleWithoutDbQuery({
        granulePgRecord,
        collectionPgRecord,
        granuleGroupRecord,
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
