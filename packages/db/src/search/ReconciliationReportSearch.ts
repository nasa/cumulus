import { Knex } from 'knex';
import Logger from '@cumulus/logger';
import pick from 'lodash/pick';
import set from 'lodash/set';

// import { BaseRecord } from '../types/base';
import { ApiReconciliationReportRecord } from '@cumulus/types/api/reconciliation_reports';
import { BaseSearch } from './BaseSearch';
import { DbQueryParameters, QueryEvent } from '../types/search';
import { translatePostgresReconReportToApiReconReport } from '../translate/reconciliation_reports';
import { PostgresReconciliationReportRecord } from '../types/reconciliation_report';
import { TableNames } from '../tables';

const log = new Logger({ sender: '@cumulus/db/ReconciliationReportSearch' });

// interface GranuleRecord extends BaseRecord, PostgresGranuleRecord {
//   cumulus_id: number,
//   updated_at: Date,
//   collection_cumulus_id: number,
//   collectionName: string,
//   collectionVersion: string,
//   pdr_cumulus_id: number,
//   pdrName?: string,
//   provider_cumulus_id?: number,
//   providerName?: string,
// }

/**
 * Class to build and execute db search query for granules
 */
export class ReconciliationReportSearch extends BaseSearch {
  constructor(event: QueryEvent) {
    // estimate the table rowcount by default
    if (event?.queryStringParameters?.estimateTableRowCount !== 'false') {
      set(event, 'queryStringParameters.estimateTableRowCount', 'true');
    }
    super(event, 'reconciliationReport');
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
      reconciliationReports: reconciliationReportsTable,
    } = TableNames;
    const countQuery = knex(this.tableName)
      .count('*');

    const searchQuery = knex(this.tableName)
      .select(`${this.tableName}.*`)
      .select({
        reconciliationReportsName: `${reconciliationReportsTable}.name`,
      });
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
  protected translatePostgresRecordsToApiRecords(pgRecords: PostgresReconciliationReportRecord[])
    : Partial<ApiReconciliationReportRecord>[] {
    log.debug(`translatePostgresRecordsToApiRecords number of records ${pgRecords.length} `);
    const { fields } = this.dbQueryParameters;

    const apiRecords = pgRecords.map((pgRecord) => {
      const apiRecord = translatePostgresReconReportToApiReconReport(pgRecord);
      return fields ? pick(apiRecord, fields) : apiRecord;
    });

    return apiRecords;
  }
}
