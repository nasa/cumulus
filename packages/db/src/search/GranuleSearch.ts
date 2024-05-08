import { Knex } from 'knex';

import { ApiGranuleRecord } from '@cumulus/types/api/granules';
import Logger from '@cumulus/logger';

import { BaseRecord } from '../types/base';
import { BaseSearch } from './BaseSearch';
import { PostgresGranuleRecord } from '../types/granule';
import { QueryEvent } from '../types/search';

import { TableNames } from '../tables';
import { translatePostgresGranuleToApiGranuleWithoutDbQuery } from '../translate/granules';

const log = new Logger({ sender: '@cumulus/db/BaseSearch' });

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

/**
 * Class to build and execute db search query for granules
 */
export class GranuleSearch extends BaseSearch {
  constructor(event: QueryEvent) {
    super(event, 'granule');
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
      .innerJoin(collectionsTable, `${granulesTable}.collection_cumulus_id`, `${collectionsTable}.cumulus_id`)
      .leftJoin(providersTable, `${granulesTable}.provider_cumulus_id`, `${providersTable}.cumulus_id`)
      .leftJoin(pdrsTable, `${granulesTable}.pdr_cumulus_id`, `${pdrsTable}.cumulus_id`);
    return { countQuery, searchQuery };
  }

  /**
   * Translate postgres records to api records
   *
   * @param pgRecords - postgres records returned from query
   * @returns translated api records
   */
  protected translatePostgresRecordsToApiRecords(pgRecords: GranuleRecord[]) : ApiGranuleRecord[] {
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
