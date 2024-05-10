import { Knex } from 'knex';
import omit from 'lodash/omit';

import { ApiGranuleRecord } from '@cumulus/types/api/granules';
import Logger from '@cumulus/logger';

import { BaseRecord } from '../types/base';
import { BaseSearch } from './BaseSearch';
import { PostgresGranuleRecord } from '../types/granule';
import { DbQueryParameters, QueryEvent } from '../types/search';

import { TableNames } from '../tables';
import { translatePostgresGranuleToApiGranuleWithoutDbQuery } from '../translate/granules';

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

const foreignFields = ['collectionName', 'collectionVersion', 'providerName', 'pdrName'];

/**
 * Class to build and execute db search query for granules
 */
export class GranuleSearch extends BaseSearch {
  constructor(event: QueryEvent) {
    super(event, 'granule');
  }

  private searchCollection(): boolean {
    const termFields = this.dbQueryParameters.termFields;
    return !!(termFields && (termFields.collectionName || termFields.collectionVersion));
  }

  private searchPdr(): boolean {
    const termFields = this.dbQueryParameters.termFields;
    return !!(termFields && termFields.pdrName);
  }

  private searchProvider(): boolean {
    const termFields = this.dbQueryParameters.termFields;
    return !!(termFields && termFields.providerName);
  }

  /**
   * build basic query
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
      .select({
        providerName: `${providersTable}.name`,
        collectionName: `${collectionsTable}.name`,
        collectionVersion: `${collectionsTable}.version`,
        pdrName: `${pdrsTable}.name`,
      })
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

  protected buildTermQuery(queries: {
    countQuery: Knex.QueryBuilder,
    searchQuery: Knex.QueryBuilder,
    dbQueryParameters?: DbQueryParameters,
  }) {
    const {
      collections: collectionsTable,
      providers: providersTable,
      pdrs: pdrsTable,
    } = TableNames;
    const { countQuery, searchQuery, dbQueryParameters } = queries;
    const { termFields = {} } = dbQueryParameters || this.dbQueryParameters;
    Object.entries(termFields).forEach(([name, value]) => {
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
    });

    super.buildTermQuery({
      ...queries,
      dbQueryParameters: { termFields: omit(termFields, foreignFields) },
    });
  }

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
   * Translate postgres records to api records
   *
   * @param pgRecords - postgres records returned from query
   * @returns translated api records
   */
  protected translatePostgresRecordsToApiRecords(pgRecords: GranuleRecord[]): ApiGranuleRecord[] {
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
      return translatePostgresGranuleToApiGranuleWithoutDbQuery({
        granulePgRecord, collectionPgRecord, pdr, providerPgRecord,
      });
    });
    return apiRecords;
  }
}
