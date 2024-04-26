import { Knex } from 'knex';
import Logger from '@cumulus/logger';
import { getKnexClient } from '../connection';

const log = new Logger({ sender: '@cumulus/db/BaseSearch' });

/**
 * Class to build db search query and return result
 */
class BaseSearch {
  readonly limit: number;
  readonly page: number;
  offset: number;
  params: any;
  type: string | null;

  constructor(event: any, type = null) {
    const logLimit = 10;
    this.type = type;
    this.params = event.queryStringParameters ?? {};
    this.page = Number.parseInt((this.params.page) ? this.params.page : 1, 10);
    this.limit = Number.parseInt((this.params.limit) ? this.params.limit : logLimit, 10);
    this.offset = (this.page - 1) * this.limit;
  }

  protected buildBasicQuery(knex: Knex): {
    countQuery: Knex.QueryBuilder,
    searchQuery: Knex.QueryBuilder,
  } {
    log.trace(`buildBasicQuery is not implemented ${knex.constructor.name}`);
    throw new Error('buildBasicQuery is not implemented');
  }

  private _buildSearch(knex: Knex)
    : {
      countQuery: Knex.QueryBuilder,
      searchQuery: Knex.QueryBuilder,
    } {
    const { countQuery, searchQuery } = this.buildBasicQuery(knex);
    const updatedQuery = searchQuery.modify((queryBuilder) => {
      if (this.limit) queryBuilder.limit(this.limit);
      if (this.offset) queryBuilder.offset(this.offset);
    });
    return { countQuery, searchQuery: updatedQuery };
  }

  private _metaTemplate(): any {
    return {
      name: 'cumulus-api',
      stack: process.env.stackName,
      table: this.type,
    };
  }

  protected translatePostgresRecordsToApiRecords(pgRecords: any) {
    log.error(`translatePostgresRecordsToApiRecords is not implemented ${pgRecords[0]}`);
    throw new Error('translatePostgresRecordsToApiRecords is not implemented');
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

      const pgRecords = await searchQuery;
      log.trace(`Search response: ${JSON.stringify(pgRecords)}`);
      const apiRecords = this.translatePostgresRecordsToApiRecords(pgRecords);

      return {
        meta,
        results: apiRecords,
      };
    } catch (error) {
      return error;
    }
  }
}

export { BaseSearch };
