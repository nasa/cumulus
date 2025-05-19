import { Knex } from 'knex';
import pick from 'lodash/pick';

import Logger from '@cumulus/logger';
import { RuleRecord } from '@cumulus/types/api/rules';
import { BaseSearch } from './BaseSearch';
import { DbQueryParameters, QueryEvent } from '../types/search';
import { PostgresRuleRecord } from '../types/rule';
import { translatePostgresRuleToApiRuleWithoutDbQuery } from '../translate/rules';
import { TableNames } from '../tables';

const log = new Logger({ sender: '@cumulus/db/RuleSearch' });

interface RuleRecordWithExternals extends PostgresRuleRecord {
  collectionName: string,
  collectionVersion: string,
  providerName?: string,
}

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
   * @param cteQueryBuilder - CTE query builder
   * @returns joined CTE query
   */
  protected buildBasicQuery(knex: Knex)
    : {
      cteQueryBuilder: Knex.QueryBuilder,
    } {
    const {
      collections: collectionsTable,
      providers: providersTable,
    } = TableNames;

    const cteQueryBuilder = knex(this.tableName)
      .select(
        `${this.tableName}.*`,
        `${collectionsTable}.name as collectionName`,
        `${collectionsTable}.version as collectionVersion`,
        `${providersTable}.name as providerName`
      )
      .leftJoin(collectionsTable, `${this.tableName}.collection_cumulus_id`, `${collectionsTable}.cumulus_id`)
      .leftJoin(providersTable, `${this.tableName}.provider_cumulus_id`, `${providersTable}.cumulus_id`);

    return { cteQueryBuilder };
  }

  /**
   * Build queries for infix and prefix
   *
   * @param params
   * @param params.cteQueryBuilder - CTE query builder
   * @param [params.dbQueryParameters] - db query parameters
   * @param [params.cteName] - CTE name
   */
  protected buildInfixPrefixQuery(params: {
    cteQueryBuilder: Knex.QueryBuilder,
    dbQueryParameters?: DbQueryParameters,
    cteName?: string,
  }) {
    const { cteQueryBuilder, dbQueryParameters } = params;
    const { infix, prefix } = dbQueryParameters ?? this.dbQueryParameters;
    if (infix) {
      cteQueryBuilder.whereLike(`${this.tableName}.name`, `%${infix}%`);
    }
    if (prefix) {
      cteQueryBuilder.whereLike(`${this.tableName}.name`, `${prefix}%`);
    }
  }

  /**
   * Translate postgres records to api records
   *
   * @param pgRecords - postgres Rule records returned from query
   * @returns translated api records
   */
  protected async translatePostgresRecordsToApiRecords(
    pgRecords: RuleRecordWithExternals[]
  ): Promise<Partial<RuleRecord>[]> {
    log.debug(`translatePostgresRecordsToApiRecords number of records ${pgRecords.length} `);

    const apiRecords = pgRecords.map(async (record) => {
      const providerPgRecord = record.providerName ? { name: record.providerName } : undefined;
      const collectionPgRecord = record.collectionName ? {
        name: record.collectionName,
        version: record.collectionVersion,
      } : undefined;
      const apiRecord = await translatePostgresRuleToApiRuleWithoutDbQuery(
        record,
        collectionPgRecord,
        providerPgRecord
      );
      return this.dbQueryParameters.fields
        ? pick(apiRecord, this.dbQueryParameters.fields)
        : apiRecord;
    });
    return await Promise.all(apiRecords);
  }
}
