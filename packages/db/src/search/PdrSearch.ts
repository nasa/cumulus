import { Knex } from 'knex';
import pick from 'lodash/pick';

import Logger from '@cumulus/logger';
import { ApiPdrRecord } from '@cumulus/types/api/pdrs';
// Import OpenTelemetry
import { trace } from '@opentelemetry/api';

import { TableNames } from '../tables';
import { translatePostgresPdrToApiPdrWithoutDbQuery } from '../translate/pdr';
import { BaseRecord } from '../types/base';
import { PostgresPdrRecord } from '../types/pdr';
import { DbQueryParameters, QueryEvent } from '../types/search';
import { BaseSearch } from './BaseSearch';

const log = new Logger({ sender: '@cumulus/db/PdrSearch' });

// Get the tracer
const tracer = trace.getTracer('cumulus-db');

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
    return tracer.startActiveSpan('PdrSearch.buildBasicQuery', (span) => {
      try {
        const {
          collections: collectionsTable,
          providers: providersTable,
          executions: executionsTable,
        } = TableNames;

        span.setAttribute('db.table', this.tableName);
        span.setAttribute('db.collections_table', collectionsTable);
        span.setAttribute('db.providers_table', providersTable);
        span.setAttribute('db.executions_table', executionsTable);

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
          .innerJoin(providersTable, `${this.tableName}.provider_cumulus_id`, `${providersTable}.cumulus_id`);

        const joinsUsed = ['collections-inner', 'providers-inner'];

        if (this.searchCollection()) {
          joinsUsed.push('collections-count-inner');
          countQuery.innerJoin(collectionsTable, `${this.tableName}.collection_cumulus_id`, `${collectionsTable}.cumulus_id`);
        }

        if (this.searchProvider()) {
          joinsUsed.push('providers-count-inner');
          countQuery.innerJoin(providersTable, `${this.tableName}.provider_cumulus_id`, `${providersTable}.cumulus_id`);
        }

        if (this.searchExecution()) {
          joinsUsed.push('executions-inner');
          countQuery.innerJoin(executionsTable, `${this.tableName}.execution_cumulus_id`, `${executionsTable}.cumulus_id`);
          searchQuery.innerJoin(executionsTable, `${this.tableName}.execution_cumulus_id`, `${executionsTable}.cumulus_id`);
        } else {
          joinsUsed.push('executions-left');
          searchQuery.leftJoin(executionsTable, `${this.tableName}.execution_cumulus_id`, `${executionsTable}.cumulus_id`);
        }

        span.setAttribute('query.joins', joinsUsed.join(','));
        span.setAttribute('query.joins_count', joinsUsed.length);

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
    return tracer.startActiveSpan('PdrSearch.buildInfixPrefixQuery', (span) => {
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
  protected translatePostgresRecordsToApiRecords(pgRecords: PdrRecord[])
    : Partial<ApiPdrRecord>[] {
    return tracer.startActiveSpan('PdrSearch.translatePostgresRecordsToApiRecords', (span) => {
      try {
        const recordCount = pgRecords.length;
        span.setAttribute('db.record_count', recordCount);
        span.setAttribute('query.has_field_filter', !!this.dbQueryParameters.fields);

        log.debug(`translatePostgresRecordsToApiRecords number of records ${recordCount}`);

        const { fields } = this.dbQueryParameters;

        const translationStartTime = Date.now();

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

        const translationDuration = Date.now() - translationStartTime;

        span.setAttribute('translation.duration_ms', translationDuration);
        span.setAttribute('translation.records_count', apiRecords.length);

        // Track how many PDRs have executions
        const pdrsWithExecutions = pgRecords.filter((r) => r.executionArn).length;
        span.setAttribute('pdrs.with_executions', pdrsWithExecutions);
        span.setAttribute('pdrs.without_executions', recordCount - pdrsWithExecutions);

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
