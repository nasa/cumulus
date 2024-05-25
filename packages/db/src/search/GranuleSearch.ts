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
import { mapQueryStringFieldToDbField } from './field-mapping';

const log = new Logger({ sender: '@cumulus/db/GranuleSearch' });

interface GranuleRecord extends BaseRecord, PostgresGranuleRecord {
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

/**
 * Class to build and execute db search query for granules
 */
export class GranuleSearch extends BaseSearch {
  constructor(event: QueryEvent) {
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
    } = TableNames;
    const countQuery = knex(this.tableName)
      .count(`${this.tableName}.cumulus_id`);

    const searchQuery = knex(this.tableName)
      .select(`${this.tableName}.*`)
      .select({
        providerName: `${providersTable}.name`,
        collectionName: `${collectionsTable}.name`,
        collectionVersion: `${collectionsTable}.version`,
        pdrName: `${pdrsTable}.name`,
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
      countQuery.whereLike(`${this.tableName}.granule_id`, `%${infix}%`);
      searchQuery.whereLike(`${this.tableName}.granule_id`, `%${infix}%`);
    }
    if (prefix) {
      countQuery.whereLike(`${this.tableName}.granule_id`, `${prefix}%`);
      searchQuery.whereLike(`${this.tableName}.granule_id`, `${prefix}%`);
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
    const { countQuery, searchQuery, dbQueryParameters } = params;
    const { term = {} } = dbQueryParameters ?? this.dbQueryParameters;

    Object.entries(term).forEach(([name, value]) => {
      if (name === 'error.Error') {
        countQuery.whereRaw(`${this.tableName}.error->>'Error' = '${value}'`);
        searchQuery.whereRaw(`${this.tableName}.error->>'Error' = '${value}'`);
      }
    });

    super.buildTermQuery({
      ...params,
      dbQueryParameters: { term: omit(term, 'error.Error') },
    });
  }

  /**
   * Build queries for sort keys and fields
   *
   * @param params
   * @param params.searchQuery - query builder for search
   * @param [params.dbQueryParameters] - db query parameters
   */
  protected buildSortQuery(params: {
    searchQuery: Knex.QueryBuilder,
    dbQueryParameters?: DbQueryParameters,
  }) {
    const { searchQuery, dbQueryParameters } = params;
    const { sortBy, sortKey, order } = dbQueryParameters || this.dbQueryParameters;
    if (sortBy) {
      const sortOrder = order || 'desc';
      const sortField = mapQueryStringFieldToDbField('granule', { name: sortBy });
      const convertedField = Object.keys(sortField as Object)[0];
      searchQuery.orderBy(`${convertedField}`, sortOrder);
    } else if (sortKey) {
      sortKey.map((key) => {
        const keyOrder = key.startsWith('-') ? 'desc' : 'asc';
        const sortField = mapQueryStringFieldToDbField('granule', { name: key.replace(/^[+-]/, '') });
        const convertedField = Object.keys(sortField as Object)[0];
        return searchQuery.orderBy(`${convertedField}`, keyOrder);
      });
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
