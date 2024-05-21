import { Knex } from 'knex';
import omit from 'lodash/omit';
import pick from 'lodash/pick';

import { ApiGranuleRecord } from '@cumulus/types/api/granules';
import Logger from '@cumulus/logger';

import { BaseRecord } from '../types/base';
import { BaseSearch } from './BaseSearch';
import { DbQueryParameters, QueryEvent } from '../types/search';
import { PostgresGranuleRecord } from '../types/granule';
import { translatePostgresGranuleToApiGranuleWithoutDbQuery } from '../translate/granules';
import { TableNames } from '../tables';

const log = new Logger({ sender: '@cumulus/db/GranuleSearch' });

export interface GranuleRecord extends BaseRecord, PostgresGranuleRecord {
  cumulus_id: number,
  updated_at: Date,
  collection_cumulus_id: number,
  collectionName: string,
  collectionVersion: string,
  pdr_cumulus_id: number,
  pdrName?: string,
  provider_cumulus_id?: number,
  providerName?: string,
}

const groupArray = {
  providerName: 'providers.name',
  collectionName: 'collections.name',
  collectionVersion: 'collections.version',
  pdrName: 'pdrs.name',
  granuleId: 'granules.cumulus_id',
};

/**
 * Class to build and execute db search query for granules
 */
export class GranuleSearch extends BaseSearch {
  constructor(event: QueryEvent) {
    super(event, 'granule');
  }

  private searchCollection(): boolean {
    const term = this.dbQueryParameters.term;
    return !!(term && (term.collectionName || term.collectionVersion));
  }

  private searchPdr(): boolean {
    const term = this.dbQueryParameters.term;
    return !!(term && term.pdrName);
  }

  private searchProvider(): boolean {
    const term = this.dbQueryParameters.term;
    return !!(term && term.providerName);
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
      granules: granulesTable,
      collections: collectionsTable,
      providers: providersTable,
      pdrs: pdrsTable,
    } = TableNames;
    const countQuery = knex(granulesTable)
      .count(`${granulesTable}.cumulus_id`);

    const searchQuery = knex(granulesTable)
      .select(`${granulesTable}.*`)
      .select(groupArray)
      .innerJoin(collectionsTable, `${granulesTable}.collection_cumulus_id`, `${collectionsTable}.cumulus_id`);

    if (this.searchCollection()) {
      countQuery.innerJoin(collectionsTable, `${granulesTable}.collection_cumulus_id`, `${collectionsTable}.cumulus_id`);
    }

    if (this.searchProvider()) {
      countQuery.innerJoin(providersTable, `${granulesTable}.provider_cumulus_id`, `${providersTable}.cumulus_id`);
      searchQuery.innerJoin(providersTable, `${granulesTable}.provider_cumulus_id`, `${providersTable}.cumulus_id`);
    } else {
      searchQuery.leftJoin(providersTable, `${granulesTable}.provider_cumulus_id`, `${providersTable}.cumulus_id`);
    }

    if (this.searchPdr()) {
      countQuery.innerJoin(pdrsTable, `${granulesTable}.pdr_cumulus_id`, `${pdrsTable}.cumulus_id`);
      searchQuery.innerJoin(pdrsTable, `${granulesTable}.pdr_cumulus_id`, `${pdrsTable}.cumulus_id`);
    } else {
      searchQuery.leftJoin(pdrsTable, `${granulesTable}.pdr_cumulus_id`, `${pdrsTable}.cumulus_id`);
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
    const { granules: granulesTable } = TableNames;
    const { countQuery, searchQuery, dbQueryParameters } = params;
    const { infix, prefix } = dbQueryParameters || this.dbQueryParameters;
    if (infix) {
      countQuery.whereLike(`${granulesTable}.granule_id`, `%${infix}%`);
      searchQuery.whereLike(`${granulesTable}.granule_id`, `%${infix}%`);
    }
    if (prefix) {
      countQuery.whereLike(`${granulesTable}.granule_id`, `${prefix}%`);
      searchQuery.whereLike(`${granulesTable}.granule_id`, `${prefix}%`);
    }
  }

  /**
   * Build queries for term fields
   *
   * @param params
   * @param params.countQuery - query builder for getting count
   * @param params.searchQuery - query builder for search
   * @param [params.dbQueryParameters] - db query parameters
   */
  protected buildTermQuery(params: {
    countQuery: Knex.QueryBuilder,
    searchQuery: Knex.QueryBuilder,
    dbQueryParameters?: DbQueryParameters,
  }) {
    const {
      granules: granulesTable,
      collections: collectionsTable,
      providers: providersTable,
      pdrs: pdrsTable,
    } = TableNames;

    const { countQuery, searchQuery, dbQueryParameters } = params;
    const { term = {} } = dbQueryParameters || this.dbQueryParameters;

    Object.entries(term).forEach(([name, value]) => {
      if (name === 'collectionName') {
        countQuery.where(`${collectionsTable}.name`, value);
        searchQuery.where(`${collectionsTable}.name`, value);
      }
      if (name === 'collectionVersion') {
        countQuery.where(`${collectionsTable}.version`, value);
        searchQuery.where(`${collectionsTable}.version`, value);
      }
      if (name === 'providerName') {
        countQuery.where(`${providersTable}.name`, value);
        searchQuery.where(`${providersTable}.name`, value);
      }
      if (name === 'pdrName') {
        countQuery.where(`${pdrsTable}.name`, value);
        searchQuery.where(`${pdrsTable}.name`, value);
      }
      if (name === 'error.Error') {
        countQuery.whereRaw(`${granulesTable}.error->>'Error' = '${value}'`);
        searchQuery.whereRaw(`${granulesTable}.error->>'Error' = '${value}'`);
      }
    });

    super.buildTermQuery({
      ...params,
      dbQueryParameters: { term: omit(term, Object.keys(groupArray), 'error.Error') },
    });
  }

  /**
   * Build queries for sort keys and fields
   *
   * @param params
   * @param params.countQuery - query builder for getting count
   * @param params.searchQuery - query builder for search
   * @param [params.dbQueryParameters] - db query parameters
   */
  protected buildSortQuery(params: {
    searchQuery: Knex.QueryBuilder,
    dbQueryParameters?: DbQueryParameters,
  }) {
    const { searchQuery } = params;
    const sortBy = this.queryStringParameters.sort_by;
    const {
      granules: granulesTable,
    } = TableNames;
    const sortKey = this.queryStringParameters.sort_key;
    Object.keys(groupArray).forEach((key) => {
      searchQuery.groupBy(key);
    });
    if (sortBy) {
      const order = this.queryStringParameters.order || 'desc';
      searchQuery.orderBy(`${granulesTable}.${sortBy}`, order).groupBy(`${granulesTable}.${sortBy}`);
    } else if (sortKey) {
      // eslint-disable-next-line array-callback-return
      sortKey.map((key) => {
        const order = key.startsWith('-') ? 'desc' : 'asc';
        const sortField = key.replace(/^[+-]/, '');
        searchQuery.orderBy(`${granulesTable}.${sortField}`, order).groupBy(`${granulesTable}.${sortField}`);
      });
    } else {
      searchQuery.orderBy(`${granulesTable}.timestamp`, 'desc').groupBy(`${granulesTable}.timestamp`);
    }
  }

  /**
   * Translate postgres records to api records
   *
   * @param pgRecords - postgres records returned from query
   * @returns translated api records
   */
  protected translatePostgresRecordsToApiRecords(pgRecords: GranuleRecord[])
    : Partial<ApiGranuleRecord>[] {
    log.debug(`translatePostgresRecordsToApiRecords number of records ${pgRecords.length} `);
    const apiRecords = pgRecords.map((item: GranuleRecord) => {
      const granulePgRecord = item;
      const collectionPgRecord = {
        cumulus_id: item.collection_cumulus_id,
        name: item.collectionName,
        version: item.collectionVersion,
      };
      const pdr = item.pdrName ? { name: item.pdrName } : undefined;
      const providerPgRecord = item.providerName ? { name: item.providerName } : undefined;
      const apiRecord = translatePostgresGranuleToApiGranuleWithoutDbQuery({
        granulePgRecord, collectionPgRecord, pdr, providerPgRecord,
      });
      return this.dbQueryParameters.fields
        ? pick(apiRecord, this.dbQueryParameters.fields)
        : apiRecord;
    });
    return apiRecords;
  }
}
