import omit from 'lodash/omit';
import { Knex } from 'knex';

import Logger from '@cumulus/logger';

import { getKnexClient } from '../connection';
import { TableNames } from '../tables';
import { DbQueryParameters, QueryEvent } from '../types/search';
import { BaseSearch } from './BaseSearch';

const log = new Logger({ sender: '@cumulus/db/StatsSearch' });

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
  count: AggregateRes[]
};

const infixMapping: { [key: string]: string } = {
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
    return {
      meta: {
        name: 'cumulus-api',
        count: totalCount,
        field: this.field,
      },
      count: responses,
    };
  }

  /**
   * Formats the postgres results into an API stats/summary response
   *
   * @param result - the knex summary query results
   * @returns the api object with the summary statistics
   */
  private formatSummaryResult(result: TotalSummary): SummaryResult {
    const timestampTo = this.dbQueryParameters.range?.updated_at?.lte ?? new Date();
    const timestampFrom = this.dbQueryParameters.range?.updated_at?.gte ?? new Date(0);
    const dateto = (timestampTo as Date).toISOString();
    const datefrom = (timestampFrom as Date).toISOString();
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
  }

  /**
   * Queries postgres for a summary of statistics around the granules in the system
   *
   * @param [testKnex] - the knex client to be used
   * @returns the postgres aggregations based on query
   */
  public async summary(testKnex?: Knex): Promise<SummaryResult> {
    const knex = testKnex ?? await getKnexClient();
    const aggregateQuery: Knex.QueryBuilder = knex(this.tableName);
    this.buildRangeQuery({ cteQueryBuilder: aggregateQuery });
    aggregateQuery.select(
      knex.raw(`COUNT(CASE WHEN ${this.tableName}.error ->> 'Error' is not null THEN 1 END) AS count_errors`),
      knex.raw('COUNT(*) AS count_granules'),
      knex.raw(`AVG(${this.tableName}.duration) AS avg_processing_time`),
      knex.raw(`COUNT(DISTINCT ${this.tableName}.collection_cumulus_id) AS count_collections`)
    );
    log.debug(`summary about to execute query: ${aggregateQuery?.toSQL().sql}`);
    const aggregateQueryRes: TotalSummary[] = await aggregateQuery;
    return this.formatSummaryResult(aggregateQueryRes[0]);
  }

  /**
   * Performs joins on the collections/pdrs/providers table if neccessary
   *
   * @param query - the knex query to be joined or not
   */
  private joinTables(query: Knex.QueryBuilder) {
    const {
      collections: collectionsTable,
      providers: providersTable,
      pdrs: pdrsTable,
    } = TableNames;
    if (this.searchCollection()) {
      query.join(collectionsTable, `${this.tableName}.collection_cumulus_id`, `${collectionsTable}.cumulus_id`);
    }

    if (this.searchProvider()) {
      query.join(providersTable, `${this.tableName}.provider_cumulus_id`, `${providersTable}.cumulus_id`);
    }

    if (this.searchPdr()) {
      query.join(pdrsTable, `${this.tableName}.pdr_cumulus_id`, `${pdrsTable}.cumulus_id`);
    }
  }

  /**
   * Aggregates the search query based on queryStringParameters
   *
   * @param query - the knex query to be aggregated
   * @param knex - the knex client to be used
   */
  private aggregateQueryField(query: Knex.QueryBuilder, knex: Knex) {
    if (this.field?.includes('error.Error')) {
      query.select(knex.raw("error ->> 'Error' as aggregatedfield"));
    } else {
      query.select(`${this.tableName}.${this.field} as aggregatedfield`);
    }
    query.modify((queryBuilder) => this.joinTables(queryBuilder))
      .count('* as count')
      .groupBy('aggregatedfield')
      .orderBy([{ column: 'count', order: 'desc' }, { column: 'aggregatedfield' }]);
  }

  /**
   * Builds basic query
   *
   * @param knex - the knex client
   * @returns the cte built query
   */
  protected buildBasicQuery(knex: Knex)
    : {
      cteQueryBuilder: Knex.QueryBuilder,
    } {
    const cteQueryBuilder:Knex.QueryBuilder = knex(this.tableName);
    this.aggregateQueryField(cteQueryBuilder, knex);
    return { cteQueryBuilder };
  }

  /**
   * Builds queries for infix and prefix
   *
   * @param params
   * @param cteQueryBuilder - CTE query builder
   * @param [params.dbQueryParameters] - the db query parameters
   * @param [params.cteName] - CTE name
   */
  protected buildInfixPrefixQuery(params: {
    cteQueryBuilder: Knex.QueryBuilder,
    dbQueryParameters?: DbQueryParameters,
    cteName?: string,
  }) {
    const { cteQueryBuilder, dbQueryParameters, cteName } = params;
    const { infix, prefix } = dbQueryParameters ?? this.dbQueryParameters;
    const table = cteName || this.tableName;
    const fieldName = infixMapping[this.tableName];
    if (infix) {
      cteQueryBuilder.whereLike(`${table}.${fieldName}`, `%${infix}%`);
    }
    if (prefix) {
      cteQueryBuilder.whereLike(`${table}.${fieldName}`, `${prefix}%`);
    }
  }

  /**
   * Builds queries for term fields
   *
   * @param params
   * @param params.cteQueryBuilder - CTE query builder
   * @param [params.dbQueryParameters] - the db query parameters
   */
  protected buildTermQuery(params: {
    cteQueryBuilder: Knex.QueryBuilder,
    dbQueryParameters?: DbQueryParameters,
  }) {
    const { cteQueryBuilder, dbQueryParameters } = params;
    const { term = {} } = dbQueryParameters ?? this.dbQueryParameters;

    if (this.field?.includes('error.Error')) {
      cteQueryBuilder.whereRaw(`${this.tableName}.error ->> 'Error' is not null`);
    }

    super.buildTermQuery({
      ...params,
      dbQueryParameters: { term: omit(term, 'error.Error') },
    });
  }

  /**
   * Executes the aggregate search query
   *
   * @param testKnex - the knex client to be used
   * @returns the aggregate query results in api format
   */
  async aggregate(testKnex?: Knex): Promise<ApiAggregateResult> {
    const knex = testKnex ?? await getKnexClient();
    const { searchQuery } = this.buildSearch(knex);
    try {
      const pgRecords = await searchQuery;
      return this.formatAggregateResult(pgRecords);
    } catch (error) {
      return error;
    }
  }
}

export { StatsSearch };
