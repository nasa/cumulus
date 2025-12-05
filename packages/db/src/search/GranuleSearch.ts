import { Knex } from 'knex';
import pick from 'lodash/pick';
import set from 'lodash/set';

import { ApiGranuleRecord } from '@cumulus/types/api/granules';
import Logger from '@cumulus/logger';

// Import OpenTelemetry
import { trace } from '@opentelemetry/api';

import { BaseRecord } from '../types/base';
import { BaseSearch } from './BaseSearch';
import { DbQueryParameters, QueryEvent } from '../types/search';
import { PostgresGranuleRecord } from '../types/granule';
import { translatePostgresGranuleToApiGranuleWithoutDbQuery } from '../translate/granules';
import { TableNames } from '../tables';
import { FilePgModel } from '../models/file';
import { PostgresFileRecord } from '../types/file';
import { getExecutionInfoByGranuleCumulusIds } from '../lib/execution';

const log = new Logger({ sender: '@cumulus/db/GranuleSearch' });

// Get the tracer
const tracer = trace.getTracer('cumulus-db');

interface GranuleRecord extends BaseRecord, PostgresGranuleRecord {
  collectionName: string,
  collectionVersion: string,
  pdrName?: string,
  providerName?: string,
}

/**
 * Class to build and execute db search query for granules
 */
export class GranuleSearch extends BaseSearch {
  constructor(event: QueryEvent) {
    // estimate the table rowcount by default
    if (event?.queryStringParameters?.estimateTableRowCount !== 'false') {
      set(event, 'queryStringParameters.estimateTableRowCount', 'true');
    }
    super(event, 'granule');
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
    return tracer.startActiveSpan('GranuleSearch.buildBasicQuery', (span) => {
      try {
        const {
          collections: collectionsTable,
          providers: providersTable,
          pdrs: pdrsTable,
        } = TableNames;

        span.setAttribute('db.table', this.tableName);
        span.setAttribute('db.collections_table', collectionsTable);

        const countQuery = knex(this.tableName)
          .count('*');

        const searchQuery = knex(this.tableName)
          .select(`${this.tableName}.*`)
          .select({
            providerName: `${providersTable}.name`,
            collectionName: `${collectionsTable}.name`,
            collectionVersion: `${collectionsTable}.version`,
            pdrName: `${pdrsTable}.name`,
          })
          .innerJoin(collectionsTable, `${this.tableName}.collection_cumulus_id`, `${collectionsTable}.cumulus_id`);

        if (this.searchCollection()) {
          span.setAttribute('query.includes_collection_join', true);
          countQuery.innerJoin(collectionsTable, `${this.tableName}.collection_cumulus_id`, `${collectionsTable}.cumulus_id`);
        }

        if (this.searchProvider()) {
          span.setAttribute('query.includes_provider_join', true);
          countQuery.innerJoin(providersTable, `${this.tableName}.provider_cumulus_id`, `${providersTable}.cumulus_id`);
          searchQuery.innerJoin(providersTable, `${this.tableName}.provider_cumulus_id`, `${providersTable}.cumulus_id`);
        } else {
          searchQuery.leftJoin(providersTable, `${this.tableName}.provider_cumulus_id`, `${providersTable}.cumulus_id`);
        }

        if (this.searchPdr()) {
          span.setAttribute('query.includes_pdr_join', true);
          countQuery.innerJoin(pdrsTable, `${this.tableName}.pdr_cumulus_id`, `${pdrsTable}.cumulus_id`);
          searchQuery.innerJoin(pdrsTable, `${this.tableName}.pdr_cumulus_id`, `${pdrsTable}.cumulus_id`);
        } else {
          searchQuery.leftJoin(pdrsTable, `${this.tableName}.pdr_cumulus_id`, `${pdrsTable}.cumulus_id`);
        }

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
    return tracer.startActiveSpan('GranuleSearch.buildInfixPrefixQuery', (span) => {
      try {
        const { countQuery, searchQuery, dbQueryParameters } = params;
        const { infix, prefix } = dbQueryParameters ?? this.dbQueryParameters;

        if (infix) {
          span.setAttribute('query.has_infix', true);
          span.setAttribute('query.infix_length', infix.length);
          [countQuery, searchQuery].forEach((query) => query.whereLike(`${this.tableName}.granule_id`, `%${infix}%`));
        }
        if (prefix) {
          span.setAttribute('query.has_prefix', true);
          span.setAttribute('query.prefix_length', prefix.length);
          [countQuery, searchQuery].forEach((query) => query.whereLike(`${this.tableName}.granule_id`, `${prefix}%`));
        }
      } finally {
        span.end();
      }
    });
  }

  /**
   * Build the search query for active collections.
   * If time params are specified the query will search granules that have been updated
   * in that time frame.  If granuleId or providerId are provided, it will filter those as well.
   *
   * @param knex - DB client
   * @returns queries for getting count and search result
   */
  public buildSearchForActiveCollections(knex: Knex)
    : {
      countQuery: Knex.QueryBuilder,
      searchQuery: Knex.QueryBuilder,
    } {
    return tracer.startActiveSpan('GranuleSearch.buildSearchForActiveCollections', (span) => {
      try {
        const { countQuery, searchQuery } = this.buildBasicQuery(knex);
        this.buildTermQuery({ countQuery, searchQuery });
        this.buildTermsQuery({ countQuery, searchQuery });
        this.buildRangeQuery({ knex, countQuery, searchQuery });

        // Add the SQL to the span for debugging
        const countSql = countQuery?.toSQL().sql;
        const searchSql = searchQuery.toSQL().sql;

        span.setAttribute('db.count_query', countSql);
        span.setAttribute('db.search_query', searchSql);

        log.debug(`buildSearchForActiveCollections returns countQuery: ${countSql}, searchQuery: ${searchSql}`);
        return { countQuery, searchQuery };
      } finally {
        span.end();
      }
    });
  }

  /**
   * Translate postgres records to api records
   *
   * @param pgRecords - postgres records returned from query
   * @param knex - DB client
   * @returns translated api records
   */
  protected async translatePostgresRecordsToApiRecords(pgRecords: GranuleRecord[], knex: Knex)
    : Promise<Partial<ApiGranuleRecord>[]> {
    return tracer.startActiveSpan('GranuleSearch.translatePostgresRecordsToApiRecords', async (span) => {
      try {
        const recordCount = pgRecords.length;
        span.setAttribute('db.record_count', recordCount);

        log.debug(`translatePostgresRecordsToApiRecords number of records ${recordCount}`);

        const { fields, includeFullRecord } = this.dbQueryParameters;
        span.setAttribute('query.include_full_record', includeFullRecord || false);
        span.setAttribute('query.has_field_filter', !!fields);

        const fileMapping: { [key: number]: PostgresFileRecord[] } = {};
        const executionMapping: { [key: number]: { url: string, granule_cumulus_id: number } } = {};
        const cumulusIds = pgRecords.map((record) => record.cumulus_id);

        if (includeFullRecord) {
          // Get Files
          await tracer.startActiveSpan('fileModel.searchByGranuleCumulusIds', async (fileSpan) => {
            try {
              fileSpan.setAttribute('db.operation', 'search');
              fileSpan.setAttribute('db.table', 'files');
              fileSpan.setAttribute('db.granule_count', cumulusIds.length);

              const fileModel = new FilePgModel();
              const files = await fileModel.searchByGranuleCumulusIds(knex, cumulusIds);

              fileSpan.setAttribute('db.files_found', files.length);

              files.forEach((file) => {
                if (!(file.granule_cumulus_id in fileMapping)) {
                  fileMapping[file.granule_cumulus_id] = [];
                }
                fileMapping[file.granule_cumulus_id].push(file);
              });
            } finally {
              fileSpan.end();
            }
          });

          // Get Executions
          await tracer.startActiveSpan('getExecutionInfoByGranuleCumulusIds', async (executionSpan) => {
            try {
              executionSpan.setAttribute('db.operation', 'search');
              executionSpan.setAttribute('db.table', 'executions');
              executionSpan.setAttribute('db.granule_count', cumulusIds.length);

              const executions = await getExecutionInfoByGranuleCumulusIds({
                knexOrTransaction: knex,
                granuleCumulusIds: cumulusIds,
              });

              executionSpan.setAttribute('db.executions_found', executions.length);

              executions.forEach((execution) => {
                if (!(execution.granule_cumulus_id in executionMapping)) {
                  executionMapping[execution.granule_cumulus_id] = execution;
                }
              });
            } finally {
              executionSpan.end();
            }
          });
        }

        // Translate records
        const apiRecords = await tracer.startActiveSpan('translateRecords', async (translateSpan) => {
          try {
            translateSpan.setAttribute('translation.record_count', recordCount);

            const records = pgRecords.map((item: GranuleRecord) => {
              const granulePgRecord = item;
              const collectionPgRecord = {
                cumulus_id: item.collection_cumulus_id,
                name: item.collectionName,
                version: item.collectionVersion,
              };
              const executionUrls = executionMapping[item.cumulus_id]?.url
                ? [{ url: executionMapping[item.cumulus_id].url }]
                : [];
              const pdr = item.pdrName ? { name: item.pdrName } : undefined;
              const providerPgRecord = item.providerName ? { name: item.providerName } : undefined;
              const fileRecords = fileMapping[granulePgRecord.cumulus_id] || [];
              const apiRecord = translatePostgresGranuleToApiGranuleWithoutDbQuery({
                granulePgRecord,
                collectionPgRecord,
                pdr,
                providerPgRecord,
                files: fileRecords,
                executionUrls,
              });
              return fields ? pick(apiRecord, fields) : apiRecord;
            });

            return records;
          } finally {
            translateSpan.end();
          }
        });

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