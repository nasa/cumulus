import { Knex } from 'knex';
import pick from 'lodash/pick';

import Logger from '@cumulus/logger';
import { ApiReconciliationReportRecord } from '@cumulus/types/api/reconciliation_reports';

import { BaseSearch } from './BaseSearch';
import { DbQueryParameters, QueryEvent } from '../types/search';
import { translatePostgresReconReportToApiReconReport } from '../translate/reconciliation_reports';
import { PostgresReconciliationReportRecord } from '../types/reconciliation_report';
import { TableNames } from '../tables';

const log = new Logger({ sender: '@cumulus/db/ReconciliationReportSearch' });

/**
 * Class to build and execute db search query for granules
 */
export class ReconciliationReportSearch extends BaseSearch {
  constructor(event: QueryEvent) {
    super(event, 'reconciliationReport');
  }

  /**
   * Build basic query
   *
   * @param knex - DB client
   * @returns count query and CTE search query builder
   */
  protected buildBasicQuery(knex: Knex): {
    countQuery?: Knex.QueryBuilder,
    cteQueryBuilder: Knex.QueryBuilder,
  } {
    const {
      reconciliationReports: reconciliationReportsTable,
    } = TableNames;

    const countQuery = knex(this.tableName).count('*');

    const cteQueryBuilder = knex(this.tableName)
      .select(`${this.tableName}.*`)
      .select({
        reconciliationReportsName: `${reconciliationReportsTable}.name`,
      });

    return { countQuery, cteQueryBuilder };
  }

  /**
   * Build queries for infix and prefix
   *
   * @param params
   * @param params.countQuery - knex query for count
   * @param params.cteQueryBuilder - CTE query builder
   * @param [params.dbQueryParameters] - db query parameters
   */
  protected buildInfixPrefixQuery(params: {
    countQuery: Knex.QueryBuilder,
    cteQueryBuilder: Knex.QueryBuilder,
    dbQueryParameters?: DbQueryParameters,
  }) {
    const { countQuery, cteQueryBuilder, dbQueryParameters } = params;
    const { infix, prefix } = dbQueryParameters ?? this.dbQueryParameters;
    if (infix) {
      [countQuery, cteQueryBuilder].forEach((query) => query.whereLike(`${this.tableName}.name`, `%${infix}%`));
    }
    if (prefix) {
      [countQuery, cteQueryBuilder].forEach((query) => query.whereLike(`${this.tableName}.name`, `${prefix}%`));
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
