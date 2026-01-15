import { Knex } from 'knex';
import pick from 'lodash/pick';

import Logger from '@cumulus/logger';
import { RuleRecord } from '@cumulus/types/api/rules';
// Import OpenTelemetry
import { trace } from '@opentelemetry/api';

import { TableNames } from '../tables';
import { translatePostgresRuleToApiRuleWithoutDbQuery } from '../translate/rules';
import { PostgresRuleRecord } from '../types/rule';
import { DbQueryParameters, QueryEvent } from '../types/search';
import { BaseSearch } from './BaseSearch';

const log = new Logger({ sender: '@cumulus/db/RuleSearch' });

// Get the tracer
const tracer = trace.getTracer('cumulus-db');

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
   * @returns queries for getting count and search result
   */
  protected buildBasicQuery(knex: Knex): {
    countQuery: Knex.QueryBuilder,
    searchQuery: Knex.QueryBuilder,
  } {
    return tracer.startActiveSpan('RuleSearch.buildBasicQuery', (span) => {
      try {
        const {
          collections: collectionsTable,
          providers: providersTable,
        } = TableNames;

        span.setAttribute('db.table', this.tableName);
        span.setAttribute('db.collections_table', collectionsTable);
        span.setAttribute('db.providers_table', providersTable);

        const countQuery = knex(this.tableName)
          .count(`${this.tableName}.cumulus_id`);

        const searchQuery = knex(this.tableName)
          .select(`${this.tableName}.*`)
          .select({
            collectionName: `${collectionsTable}.name`,
            collectionVersion: `${collectionsTable}.version`,
            providerName: `${providersTable}.name`,
          });

        const joinsUsed = [];

        if (this.searchCollection()) {
          joinsUsed.push('collections-inner');
          searchQuery.innerJoin(collectionsTable, `${this.tableName}.collection_cumulus_id`, `${collectionsTable}.cumulus_id`);
          countQuery.innerJoin(collectionsTable, `${this.tableName}.collection_cumulus_id`, `${collectionsTable}.cumulus_id`);
        } else {
          joinsUsed.push('collections-left');
          searchQuery.leftJoin(collectionsTable, `${this.tableName}.collection_cumulus_id`, `${collectionsTable}.cumulus_id`);
        }

        if (this.searchProvider()) {
          joinsUsed.push('providers-inner');
          searchQuery.innerJoin(providersTable, `${this.tableName}.provider_cumulus_id`, `${providersTable}.cumulus_id`);
          countQuery.innerJoin(providersTable, `${this.tableName}.provider_cumulus_id`, `${providersTable}.cumulus_id`);
        } else {
          joinsUsed.push('providers-left');
          searchQuery.leftJoin(providersTable, `${this.tableName}.provider_cumulus_id`, `${providersTable}.cumulus_id`);
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
    return tracer.startActiveSpan('RuleSearch.buildInfixPrefixQuery', (span) => {
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
   * @param pgRecords - postgres Rule records returned from query
   * @param knex - knex for the translation method
   * @returns translated api records
   */
  protected async translatePostgresRecordsToApiRecords(
    pgRecords: RuleRecordWithExternals[]
  ): Promise<Partial<RuleRecord>[]> {
    return tracer.startActiveSpan('RuleSearch.translatePostgresRecordsToApiRecords', async (span) => {
      try {
        const recordCount = pgRecords.length;
        span.setAttribute('db.record_count', recordCount);
        span.setAttribute('query.has_field_filter', !!this.dbQueryParameters.fields);

        log.debug(`translatePostgresRecordsToApiRecords number of records ${recordCount}`);

        const translationStartTime = Date.now();

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

        const results = await Promise.all(apiRecords);
        const translationDuration = Date.now() - translationStartTime;

        span.setAttribute('translation.duration_ms', translationDuration);
        span.setAttribute('translation.records_count', results.length);

        // Track how many rules have collections and providers
        const rulesWithCollections = pgRecords.filter((r) => r.collectionName).length;
        const rulesWithProviders = pgRecords.filter((r) => r.providerName).length;

        span.setAttribute('rules.with_collections', rulesWithCollections);
        span.setAttribute('rules.with_providers', rulesWithProviders);

        return results;
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
