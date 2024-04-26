import { Knex } from 'knex';

import Logger from '@cumulus/logger';
import { translatePostgresGranuleToApiGranuleWithoutDbQuery } from '../translate/granules';

import { BaseSearch } from './BaseSearch';
import { TableNames } from '../tables';

const log = new Logger({ sender: '@cumulus/db/GranuleSearch' });

export class GranuleSearch extends BaseSearch {
  constructor(event: any) {
    super(event, 'granule');
  }

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
      .count(`${granulesTable}.cumulus_id`)
      .innerJoin(collectionsTable, `${granulesTable}.collection_cumulus_id`, `${collectionsTable}.cumulus_id`)
      .leftJoin(providersTable, `${granulesTable}.provider_cumulus_id`, `${providersTable}.cumulus_id`)
      .leftJoin(pdrsTable, `${granulesTable}.pdr_cumulus_id`, `${pdrsTable}.cumulus_id`);

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

  protected translatePostgresRecordsToApiRecords(pgRecords: any[]) {
    const apiRecords = pgRecords.map((item: any) => {
      log.trace(`About to translate item: ${JSON.stringify(item)}`);
      const granulePgRecord = item;
      const collectionPgRecord = {
        cumulus_id: item.collection_cumulus_id,
        name: item.collectionName,
        version: item.collectionVersion,
      };
      const providerPgRecord = item.provider_cumulus_id
        ?? { cumulus_id: item.provider_cumulus_id, name: item.providerName };
      log.trace(JSON.stringify(item));
      return translatePostgresGranuleToApiGranuleWithoutDbQuery({
        granulePgRecord, collectionPgRecord, providerPgRecord,
      });
    });
    return apiRecords;
  }
}
