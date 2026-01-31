import { Knex } from 'knex';
import pick from 'lodash/pick';

import Logger from '@cumulus/logger';
import { ApiProvider } from '@cumulus/types/api/providers';

// Import OpenTelemetry
import { trace } from '@opentelemetry/api';

import { BaseSearch } from './BaseSearch';
import { DbQueryParameters, QueryEvent } from '../types/search';
import { translatePostgresProviderToApiProvider } from '../translate/providers';
import { PostgresProviderRecord } from '../types/provider';

const log = new Logger({ sender: '@cumulus/db/ProviderSearch' });

// Get the tracer
const tracer = trace.getTracer('cumulus-db');

/**
 * Class to build and execute db search query for collections
 */
export class ProviderSearch extends BaseSearch {
  constructor(event: QueryEvent) {
    const queryStringParameters = event.queryStringParameters || {};
    super({ queryStringParameters }, 'provider');
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
    return tracer.startActiveSpan('ProviderSearch.buildInfixPrefixQuery', (span) => {
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
   * @param pgRecords - postgres Provider records returned from query
   * @returns translated api records
   */
  protected async translatePostgresRecordsToApiRecords(pgRecords: PostgresProviderRecord[])
    : Promise<Partial<ApiProvider>[]> {
    return tracer.startActiveSpan('ProviderSearch.translatePostgresRecordsToApiRecords', async (span) => {
      try {
        const recordCount = pgRecords.length;
        span.setAttribute('db.record_count', recordCount);
        span.setAttribute('query.has_field_filter', !!this.dbQueryParameters.fields);

        log.debug(`translatePostgresRecordsToApiRecords number of records ${recordCount}`);

        const translationStartTime = Date.now();
        const apiRecords = pgRecords.map((record) => {
          const apiRecord: ApiProvider = translatePostgresProviderToApiProvider(record);
          const apiRecordFinal = this.dbQueryParameters.fields
            ? pick(apiRecord, this.dbQueryParameters.fields)
            : apiRecord;
          return apiRecordFinal;
        });
        const translationDuration = Date.now() - translationStartTime;

        span.setAttribute('translation.duration_ms', translationDuration);
        span.setAttribute('translation.records_count', apiRecords.length);

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
