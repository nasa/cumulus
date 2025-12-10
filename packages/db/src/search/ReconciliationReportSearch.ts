import { Knex } from 'knex';
import Logger from '@cumulus/logger';
import pick from 'lodash/pick';
import { ApiReconciliationReportRecord } from '@cumulus/types/api/reconciliation_reports';

// Import OpenTelemetry
import { trace } from '@opentelemetry/api';

import { BaseSearch } from './BaseSearch';
import { DbQueryParameters, QueryEvent } from '../types/search';
import { translatePostgresReconReportToApiReconReport } from '../translate/reconciliation_reports';
import { PostgresReconciliationReportRecord } from '../types/reconciliation_report';
import { TableNames } from '../tables';

const log = new Logger({ sender: '@cumulus/db/ReconciliationReportSearch' });

// Get the tracer
const tracer = trace.getTracer('cumulus-db');

/**
 * Class to build and execute db search query for reconciliation reports
 */
export class ReconciliationReportSearch extends BaseSearch {
  constructor(event: QueryEvent) {
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
    return tracer.startActiveSpan('ReconciliationReportSearch.buildBasicQuery', (span) => {
      try {
        const {
          reconciliationReports: reconciliationReportsTable,
        } = TableNames;

        span.setAttribute('db.table', this.tableName);
        span.setAttribute('db.reconciliation_reports_table', reconciliationReportsTable);

        const countQuery = knex(this.tableName)
          .count('*');

        const searchQuery = knex(this.tableName)
          .select(`${this.tableName}.*`)
          .select({
            reconciliationReportsName: `${reconciliationReportsTable}.name`,
          });

        span.setAttribute('query.joins_count', 0);

        return { countQuery, searchQuery };
      } finally {
        span.end();
      }
    });
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
    return tracer.startActiveSpan('ReconciliationReportSearch.buildInfixPrefixQuery', (span) => {
      try {
        const { countQuery, searchQuery, dbQueryParameters } = params;
        const { infix, prefix } = dbQueryParameters ?? this.dbQueryParameters;

        if (infix) {
          span.setAttribute('query.has_infix', true);
          span.setAttribute('query.infix_length', infix.length);
          [countQuery, searchQuery].forEach((query) => query.whereLike(`${this.tableName}.name`, `%${infix}%`));
        }
        if (prefix) {
          span.setAttribute('query.has_prefix', true);
          span.setAttribute('query.prefix_length', prefix.length);
          [countQuery, searchQuery].forEach((query) => query.whereLike(`${this.tableName}.name`, `${prefix}%`));
        }
      } finally {
        span.end();
      }
    });
  }

  /**
   * Translate postgres records to api records
   *
   * @param pgRecords - postgres records returned from query
   * @returns translated api records
   */
  protected translatePostgresRecordsToApiRecords(pgRecords: PostgresReconciliationReportRecord[])
    : Partial<ApiReconciliationReportRecord>[] {
    return tracer.startActiveSpan('ReconciliationReportSearch.translatePostgresRecordsToApiRecords', (span) => {
      try {
        const recordCount = pgRecords.length;
        span.setAttribute('db.record_count', recordCount);
        span.setAttribute('query.has_field_filter', !!this.dbQueryParameters.fields);

        log.debug(`translatePostgresRecordsToApiRecords number of records ${recordCount}`);

        const { fields } = this.dbQueryParameters;

        const translationStartTime = Date.now();

        const apiRecords = pgRecords.map((pgRecord) => {
          const apiRecord = translatePostgresReconReportToApiReconReport(pgRecord);
          return fields ? pick(apiRecord, fields) : apiRecord;
        });

        const translationDuration = Date.now() - translationStartTime;

        span.setAttribute('translation.duration_ms', translationDuration);
        span.setAttribute('translation.records_count', apiRecords.length);

        // Track reconciliation report characteristics
        const reportsWithStatus = pgRecords.filter(r => r.status).length;
        span.setAttribute('reconciliation_reports.with_status', reportsWithStatus);

        return apiRecords;
      } catch (error) {
        span.recordException(error as Error);
        span.setAttribute('error', true);
        throw error;
      } finally {
        span.end();
      }
    });
  }
}
