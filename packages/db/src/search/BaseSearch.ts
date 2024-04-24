import { Knex } from 'knex';

import Logger from '@cumulus/logger';
import { getKnexClient } from '../connection';
import { TableNames } from '../tables';
import { translatePostgresGranuleToApiGranuleWithoutDbQuery } from '../translate/granules';

const log = new Logger({ sender: '@cumulus/db/DbClient' });
/**
 * Class to handle fetching results for an arbitrary PostgreSQL query and
 * paging through them.
 */
class BaseSearch {
  //readonly query: Knex.QueryBuilder;
  readonly limit: number;
  readonly page: number;
  offset: number;
  params: object;
  type: string | null;

  constructor(event: any, type = null) {
    let params: any = {};
    const logLimit = 10;
    //this.query = query;
    this.type = type;

    // this will allow us to receive payload
    // from GET and POST requests
    if (event.queryStringParameters) {
      params = event.queryStringParameters;
    }

    // get page number
    this.page = Number.parseInt((params.page) ? params.page : 1, 10);
    this.params = params;
    //log.debug('Generated params:', params, logDetails);

    this.limit = Number.parseInt((params.limit) ? params.limit : logLimit, 10);

    this.offset = (this.page - 1) * this.limit;
  }

  _buildSearch(knex: Knex)
    : {
      countQuery: Knex.QueryBuilder,
      searchQuery: Knex.QueryBuilder,
    } {
    const {
      granules: granulesTable,
      collections: collectionsTable,
      providers: providersTable,
    } = TableNames;
    const countQuery = knex(granulesTable)
      .count(`${granulesTable}.cumulus_id`)
      .innerJoin(collectionsTable, `${granulesTable}.collection_cumulus_id`, `${collectionsTable}.cumulus_id`)
      .leftJoin(providersTable, `${granulesTable}.provider_cumulus_id`, `${providersTable}.cumulus_id`);

    const searchQuery = knex(granulesTable)
      .select(`${granulesTable}.*`)
      .select({
        providerName: `${providersTable}.name`,
        collectionName: `${collectionsTable}.name`,
        collectionVersion: `${collectionsTable}.version`,
      })
      .innerJoin(collectionsTable, `${granulesTable}.collection_cumulus_id`, `${collectionsTable}.cumulus_id`)
      .leftJoin(providersTable, `${granulesTable}.provider_cumulus_id`, `${providersTable}.cumulus_id`)
      .limit(this.limit)
      .offset(this.offset);
    return { countQuery, searchQuery };
  }

  _metaTemplate(): any {
    return {
      name: 'cumulus-api',
      stack: process.env.stackName,
      table: this.type,
    };
  }

  async query() {
    const knex = await getKnexClient();
    const { countQuery, searchQuery } = this._buildSearch(knex);
    try {
      const meta = this._metaTemplate();
      meta.limit = this.limit;
      meta.page = this.page;
      const countResult = await countQuery;
      log.trace(`Count response: ${JSON.stringify(countResult)}`);
      meta.count = Number(countResult[0]?.count ?? 0);

      const searchResult = await searchQuery;
      log.trace(`Search response: ${JSON.stringify(searchResult)}`);
      const convertedResult = searchResult.map((item: any) => {
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

      return {
        meta,
        results: convertedResult,
      };
    } catch (error) {
      return error;
    }
  }
}

export { BaseSearch };
