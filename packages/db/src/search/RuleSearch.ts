import { Knex } from 'knex';
import pick from 'lodash/pick';

import Logger from '@cumulus/logger';
// import { RuleRecord } from '@cumulus/types/api/rules';
import { BaseSearch } from './BaseSearch';
import { DbQueryParameters, QueryEvent } from '../types/search';
import { PostgresRuleRecord } from '../types/rule';
import { translatePostgresRuleToApiRule } from '../translate/rules';
import { TableNames } from '../tables';

const log = new Logger({ sender: '@cumulus/db/RuleSearch' });

/**
 * Class to build and execute db search query for rules
 */
export class RuleSearch extends BaseSearch {
  constructor(event: QueryEvent) {
    super(event, 'rule');
  }

  /**
  * Build basic query
  *
  * @param knex - DB client
  * @returns queries for getting count and search result
  */
  protected buildBasicQuery(knex: Knex): {
    countQuery: Knex.QueryBuilder,
    searchQuery: Knex.QueryBuilder,
  } {
    const {
      collections: collectionsTable,
      providers: providersTable,
    } = TableNames;

    const countQuery = knex(this.tableName)
      .count(`${this.tableName}.cumulus_id`);

    const searchQuery = knex(this.tableName)
      .select(`${this.tableName}.*`)
      .select({
        collectionName: `${collectionsTable}.name`,
        collectionVersion: `${collectionsTable}.version`,
        provider: `${providersTable}.name`,
      });

    if (this.searchCollection()) {
      searchQuery.innerJoin(collectionsTable, `${this.tableName}.collection_cumulus_id`, `${collectionsTable}.cumulus_id`);
      countQuery.innerJoin(collectionsTable, `${this.tableName}.collection_cumulus_id`, `${collectionsTable}.cumulus_id`);
    } else {
      searchQuery.leftJoin(collectionsTable, `${this.tableName}.collection_cumulus_id`, `${collectionsTable}.cumulus_id`);
    }

    if (this.searchProvider()) {
      searchQuery.innerJoin(providersTable, `${this.tableName}.provider_cumulus_id`, `${providersTable}.cumulus_id`);
      countQuery.innerJoin(providersTable, `${this.tableName}.provider_cumulus_id`, `${providersTable}.cumulus_id`);
    } else {
      searchQuery.leftJoin(providersTable, `${this.tableName}.provider_cumulus_id`, `${providersTable}.cumulus_id`);
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
      [countQuery, searchQuery].forEach((query) => query.whereLike(`${this.tableName}.name`, `%${infix}%`));
    }
    if (prefix) {
      [countQuery, searchQuery].forEach((query) => query.whereLike(`${this.tableName}.name`, `%${prefix}%`));
    }
  }

  /**
  * Translate postgres records to api records
  *
  * @param pgRecords - postgres Rule records returned from query
  * @param knex - knex for the translation method
  * @returns translated api records
  */
  protected async translatePostgresRecordsToApiRecords(
    pgRecords: PostgresRuleRecord[],
    knex: Knex
  ): Promise<any> { // TODO you sure about that?
    log.debug(`translatePostgresRecordsToApiRecords number of records ${pgRecords.length} `);

    const apiRecords = await Promise.all(pgRecords.map(async (record) => {
      const apiRecord = await translatePostgresRuleToApiRule(record, knex);
      return this.dbQueryParameters.fields
        ? pick(apiRecord, this.dbQueryParameters.fields)
        : apiRecord;
    }));
    return apiRecords;
  }
}
