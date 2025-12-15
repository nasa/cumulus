import { Knex } from 'knex';
import omit from 'lodash/omit';

import Logger from '@cumulus/logger';
// Import OpenTelemetry
import { trace } from '@opentelemetry/api';

import { getKnexClient } from '../connection';
import { TableNames } from '../tables';
import { DbQueryParameters, QueryEvent } from '../types/search';
import { BaseSearch } from './BaseSearch';

const log = new Logger({ sender: '@cumulus/db/StatsSearch' });

// Get the tracer
const tracer = trace.getTracer('cumulus-db');

type TotalSummary = {
  count_errors: number,
  count_collections: number,
  count_granules: number,
  avg_processing_time: number,
};

type Aggregate = {
  count: string,
  aggregatedfield: string,
};

type Summary = {
  dateFrom: string,
  dateTo: string,
  value: number,
  aggregation: string,
  unit: string,
};

type SummaryResult = {
  errors: Summary,
  granules: Summary,
  collections: Summary,
  processingTime: Summary,
};

type Meta = {
  name: string,
  count: number,
  field: string,
};

type AggregateRes = {
  key: string,
  count: number,
};

type ApiAggregateResult = {
  meta: Meta,
  count: AggregateRes[];
};

const infixMapping: { [key: string]: string; } = {
  granules: 'granule_id',
  collections: 'name',
  providers: 'name',
  executions: 'arn',
  pdrs: 'name',
  reconciliationReports: 'name',
};

/**
 * A class to query postgres for the STATS and STATS/AGGREGATE endpoints
 */
class StatsSearch extends BaseSearch {
  readonly field: string;

  constructor(event: QueryEvent, type: string) {
    const { field, ...queryStringParameters } = event.queryStringParameters || {};
    super({ queryStringParameters: { ...queryStringParameters, limit: 'null' } }, type);
    this.field = field ?? 'status';
  }

  /**
   * Formats the postgres records into an API stats/aggregate response
   *
   * @param result - the postgres query results
   * @returns the api object with the aggregate statistics
   */
  private formatAggregateResult(result: Record<string, Aggregate>): ApiAggregateResult {
    return tracer.startActiveSpan('StatsSearch.formatAggregateResult', (span) => {
      try {
        const resultCount = Object.keys(result).length;
        span.setAttribute('stats.result_rows', resultCount);
        span.setAttribute('stats.field', this.field);

        let totalCount = 0;
        const responses = [];
        for (const row of Object.keys(result)) {
          responses.push(
            {
              key: result[row].aggregatedfield,
              count: Number.parseInt(result[row].count, 10),
            }
          );
          totalCount += Number(result[row].count);
        }

        span.setAttribute('stats.total_count', totalCount);

        return {
          meta: {
            name: 'cumulus-api',
            count: totalCount,
            field: this.field,
          },
          count: responses,
        };
      } finally {
        span.end();
      }
    });
  }

  /**
   * Formats the postgres results into an API stats/summary response
   *
   * @param result - the knex summary query results
   * @returns the api object with the summary statistics
   */
  private formatSummaryResult(result: TotalSummary): SummaryResult {
    return tracer.startActiveSpan('StatsSearch.formatSummaryResult', (span) => {
      try {
        const timestampTo = this.dbQueryParameters.range?.updated_at?.lte ?? new Date();
        const timestampFrom = this.dbQueryParameters.range?.updated_at?.gte ?? new Date(0);
        const dateto = (timestampTo as Date).toISOString();
        const datefrom = (timestampFrom as Date).toISOString();

        span.setAttribute('stats.date_from', datefrom);
        span.setAttribute('stats.date_to', dateto);
        span.setAttribute('stats.count_errors', Number(result.count_errors));
        span.setAttribute('stats.count_collections', Number(result.count_collections));
        span.setAttribute('stats.count_granules', Number(result.count_granules));
        span.setAttribute('stats.avg_processing_time', Number(result.avg_processing_time));

        return {
          errors: {
            dateFrom: datefrom,
            dateTo: dateto,
            value: Number(result.count_errors),
            aggregation: 'count',
            unit: 'error',
          },
          collections: {
            dateFrom: datefrom,
            dateTo: dateto,
            value: Number(result.count_collections),
            aggregation: 'count',
            unit: 'collection',
          },
          processingTime: {
            dateFrom: datefrom,
            dateTo: dateto,
            value: Number(result.avg_processing_time),
            aggregation: 'average',
            unit: 'second',
          },
          granules: {
            dateFrom: datefrom,
            dateTo: dateto,
            value: Number(result.count_granules),
            aggregation: 'count',
            unit: 'granule',
          },
        };
      } finally {
        span.end();
      }
    });
  }

  /**
   * Queries postgres for a summary of statistics around the granules in the system
   *
   * @param testKnex - the knex client to be used
   * @returns the postgres aggregations based on query
   */
  public async summary(testKnex?: Knex): Promise<SummaryResult> {
    return tracer.startActiveSpan('StatsSearch.summary', async (span) => {
      try {
        span.setAttribute('db.table', this.tableName);
        span.setAttribute('stats.operation', 'summary');

        const knex = testKnex ?? await getKnexClient();
        const aggregateQuery: Knex.QueryBuilder = knex(this.tableName);
        this.buildRangeQuery({ searchQuery: aggregateQuery });
        aggregateQuery.select(
          knex.raw(`COUNT(CASE WHEN ${this.tableName}.error ->> 'Error' is not null THEN 1 END) AS count_errors`),
          knex.raw('COUNT(*) AS count_granules'),
          knex.raw(`AVG(${this.tableName}.duration) AS avg_processing_time`),
          knex.raw(`COUNT(DISTINCT ${this.tableName}.collection_cumulus_id) AS count_collections`)
        );

        const querySql = aggregateQuery?.toSQL().sql;
        span.setAttribute('db.query', querySql);

        log.debug(`summary about to execute query: ${querySql}`);

        const queryStartTime = Date.now();
        const aggregateQueryRes: TotalSummary[] = await aggregateQuery;
        const queryDuration = Date.now() - queryStartTime;

        span.setAttribute('db.query_duration_ms', queryDuration);

        return this.formatSummaryResult(aggregateQueryRes[0]);
      } catch (error) {
        span.recordException(error as Error);
        span.setAttribute('error', true);
        throw error;
      } finally {
        span.end();
      }
    });
  }

  /**
   * Performs joins on the collections/pdrs/providers table if neccessary
   *
   * @param query - the knex query to be joined or not
   */
  private joinTables(query: Knex.QueryBuilder) {
    return tracer.startActiveSpan('StatsSearch.joinTables', (span) => {
      try {
        const {
          collections: collectionsTable,
          providers: providersTable,
          pdrs: pdrsTable,
        } = TableNames;

        const joinsNeeded = [];

        if (this.searchCollection()) {
          joinsNeeded.push('collections');
          query.join(collectionsTable, `${this.tableName}.collection_cumulus_id`, `${collectionsTable}.cumulus_id`);
        }

        if (this.searchProvider()) {
          joinsNeeded.push('providers');
          query.join(providersTable, `${this.tableName}.provider_cumulus_id`, `${providersTable}.cumulus_id`);
        }

        if (this.searchPdr()) {
          joinsNeeded.push('pdrs');
          query.join(pdrsTable, `${this.tableName}.pdr_cumulus_id`, `${pdrsTable}.cumulus_id`);
        }

        span.setAttribute('query.joins_count', joinsNeeded.length);
        if (joinsNeeded.length > 0) {
          span.setAttribute('query.joined_tables', joinsNeeded.join(','));
        }
      } finally {
        span.end();
      }
    });
  }

  /**
   * Aggregates the search query based on queryStringParameters
   *
   * @param query - the knex query to be aggregated
   * @param knex - the knex client to be used
   */
  private aggregateQueryField(query: Knex.QueryBuilder, knex: Knex) {
    return tracer.startActiveSpan('StatsSearch.aggregateQueryField', (span) => {
      try {
        span.setAttribute('stats.field', this.field);
        span.setAttribute('stats.is_error_field', this.field?.includes('error.Error') || false);

        if (this.field?.includes('error.Error')) {
          query.select(knex.raw("error ->> 'Error' as aggregatedfield"));
        } else {
          query.select(`${this.tableName}.${this.field} as aggregatedfield`);
        }
        query.modify((queryBuilder) => this.joinTables(queryBuilder))
          .count('* as count')
          .groupBy('aggregatedfield')
          .orderBy([{ column: 'count', order: 'desc' }, { column: 'aggregatedfield' }]);
      } finally {
        span.end();
      }
    });
  }

  /**
   * Builds basic query
   *
   * @param knex - the knex client
   * @returns the search query
   */
  protected buildBasicQuery(knex: Knex)
    : {
      searchQuery: Knex.QueryBuilder,
    } {
    return tracer.startActiveSpan('StatsSearch.buildBasicQuery', (span) => {
      try {
        span.setAttribute('db.table', this.tableName);
        span.setAttribute('stats.field', this.field);

        const searchQuery: Knex.QueryBuilder = knex(this.tableName);
        this.aggregateQueryField(searchQuery, knex);
        return { searchQuery };
      } finally {
        span.end();
      }
    });
  }

  /**
   * Builds queries for infix and prefix
   *
   * @param params
   * @param params.searchQuery - the search query
   * @param [params.dbQueryParameters] - the db query parameters
   */
  protected buildInfixPrefixQuery(params: {
    searchQuery: Knex.QueryBuilder,
    dbQueryParameters?: DbQueryParameters,
  }) {
    return tracer.startActiveSpan('StatsSearch.buildInfixPrefixQuery', (span) => {
      try {
        const { searchQuery, dbQueryParameters } = params;
        const { infix, prefix } = dbQueryParameters || this.dbQueryParameters;
        const fieldName = infixMapping[this.tableName];

        span.setAttribute('query.field_name', fieldName);

        if (infix) {
          span.setAttribute('query.has_infix', true);
          span.setAttribute('query.infix_length', infix.length);
          searchQuery.whereLike(`${this.tableName}.${fieldName}`, `%${infix}%`);
        }
        if (prefix) {
          span.setAttribute('query.has_prefix', true);
          span.setAttribute('query.prefix_length', prefix.length);
          searchQuery.whereLike(`${this.tableName}.${fieldName}`, `${prefix}%`);
        }
      } finally {
        span.end();
      }
    });
  }

  /**
   * Builds queries for term fields
   *
   * @param params
   * @param params.searchQuery - the search query
   * @param [params.dbQueryParameters] - the db query parameters
   */
  protected buildTermQuery(params: {
    searchQuery: Knex.QueryBuilder,
    dbQueryParameters?: DbQueryParameters,
  }) {
    return tracer.startActiveSpan('StatsSearch.buildTermQuery', (span) => {
      try {
        const { dbQueryParameters, searchQuery } = params;
        const { term = {} } = dbQueryParameters ?? this.dbQueryParameters;

        const isErrorField = this.field?.includes('error.Error');
        span.setAttribute('stats.is_error_field', isErrorField);

        if (isErrorField) {
          searchQuery.whereRaw(`${this.tableName}.error ->> 'Error' is not null`);
        }

        super.buildTermQuery({
          ...params,
          dbQueryParameters: { term: omit(term, 'error.Error') },
        });
      } finally {
        span.end();
      }
    });
  }

  /**
   * Executes the aggregate search query
   *
   * @param testKnex - the knex client to be used
   * @returns the aggregate query results in api format
   */
  async aggregate(testKnex?: Knex): Promise<ApiAggregateResult> {
    return tracer.startActiveSpan('StatsSearch.aggregate', async (span) => {
      try {
        span.setAttribute('db.table', this.tableName);
        span.setAttribute('stats.operation', 'aggregate');
        span.setAttribute('stats.field', this.field);

        const knex = testKnex ?? await getKnexClient();
        const { searchQuery } = this.buildSearch(knex);

        const querySql = searchQuery?.toSQL().sql;
        span.setAttribute('db.query', querySql);

        try {
          const queryStartTime = Date.now();
          const pgRecords = await searchQuery;
          const queryDuration = Date.now() - queryStartTime;

          span.setAttribute('db.query_duration_ms', queryDuration);
          span.setAttribute('db.result_rows', pgRecords.length);

          return this.formatAggregateResult(pgRecords);
        } catch (error) {
          span.recordException(error as Error);
          span.setAttribute('error', true);
          return error;
        }
      } finally {
        span.end();
      }
    });
  }
}

export { StatsSearch };
