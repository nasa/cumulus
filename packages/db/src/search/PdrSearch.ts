import { Knex } from 'knex';
import pick from 'lodash/pick';

import { ApiPdrRecord } from '@cumulus/types/api/pdrs';
import Logger from '@cumulus/logger';

import { BaseRecord } from '../types/base';
import { BaseSearch } from './BaseSearch';
import { DbQueryParameters, QueryEvent } from '../types/search';
import { PostgresPdrRecord } from '../types/pdr';
import { translatePostgresPdrToApiPdrWithoutDbQuery } from '../translate/pdr';
import { TableNames } from '../tables';

const log = new Logger({ sender: '@cumulus/db/PdrSearch' });

interface PdrRecord extends BaseRecord, PostgresPdrRecord {
  collectionName: string,
  collectionVersion: string,
  executionArn?: string,
  providerName: string,
}

/**
 * Class to build and execute db search query for PDRs
 */
export class PdrSearch extends BaseSearch {
  constructor(event: QueryEvent) {
    super(event, 'pdr');
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
      executions: executionsTable,
    } = TableNames;
    const countQuery = knex(this.tableName)
      .count('*');

    const searchQuery = knex(this.tableName)
      .select(`${this.tableName}.*`)
      .select({
        providerName: `${providersTable}.name`,
        collectionName: `${collectionsTable}.name`,
        collectionVersion: `${collectionsTable}.version`,
        executionArn: `${executionsTable}.arn`,
      })
      .innerJoin(collectionsTable, `${this.tableName}.collection_cumulus_id`, `${collectionsTable}.cumulus_id`)
      .innerJoin(providersTable, `${this.tableName}.provider_cumulus_id`, `${providersTable}.cumulus_id`)
      .leftJoin(executionsTable, `${this.tableName}.execution_cumulus_id`, `${executionsTable}.cumulus_id`);

    if (this.searchCollection()) {
      countQuery.innerJoin(collectionsTable, `${this.tableName}.collection_cumulus_id`, `${collectionsTable}.cumulus_id`);
    }

    if (this.searchProvider()) {
      countQuery.innerJoin(providersTable, `${this.tableName}.provider_cumulus_id`, `${providersTable}.cumulus_id`);
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
      [countQuery, searchQuery].forEach((query) => query.whereLike(`${this.tableName}.name`, `${prefix}%`));
    }
  }

  /**
   * Translate postgres records to api records
   *
   * @param pgRecords - postgres records returned from query
   * @returns translated api records
   */
  protected translatePostgresRecordsToApiRecords(pgRecords: PdrRecord[])
    : Partial<ApiPdrRecord>[] {
    log.debug(`translatePostgresRecordsToApiRecords number of records ${pgRecords.length} `);
    const { fields } = this.dbQueryParameters;
    const apiRecords = pgRecords.map((item: PdrRecord) => {
      const pdrPgRecord = item;
      const collectionPgRecord = {
        cumulus_id: item.collection_cumulus_id,
        name: item.collectionName,
        version: item.collectionVersion,
      };
      const providerPgRecord = { name: item.providerName };
      const executionArn = item.executionArn;
      const apiRecord = translatePostgresPdrToApiPdrWithoutDbQuery({
        pdrPgRecord, collectionPgRecord, executionArn, providerPgRecord,
      });
      return fields ? pick(apiRecord, fields) : apiRecord;
    });
    return apiRecords;
  }
}
