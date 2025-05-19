import { Knex } from 'knex';
import Logger from '@cumulus/logger';
import pick from 'lodash/pick';

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
   * @returns CTE query builder
   */
  protected buildBasicQuery(knex: Knex)
    : {
      cteQueryBuilder: Knex.QueryBuilder,
    } {
    const {
      reconciliationReports: reconciliationReportsTable,
    } = TableNames;

    const cteQueryBuilder = knex(this.tableName)
      .select(`${this.tableName}.*`)
      .select({
        reconciliationReportsName: `${reconciliationReportsTable}.name`,
      });

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
