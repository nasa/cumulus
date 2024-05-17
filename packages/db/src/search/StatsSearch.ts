import omit from 'lodash/omit';
import { Knex } from 'knex';
import { getKnexClient } from '../connection';
import { TableNames } from '../tables';
import { DbQueryParameters, QueryEvent } from '../types/search';
import { BaseSearch } from './BaseSearch';

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
};

/**
 * A class to query postgres for the STATS and STATS/AGGREGATE endpoints
 */
class StatsSearch extends BaseSearch {
  constructor(event: QueryEvent, type: string) {
    super(event, type);
    this.queryStringParameters.field = this.queryStringParameters.field ?? 'status';
    this.dbQueryParameters = omit(this.dbQueryParameters, ['limit', 'offset']);
  }

  /**
   * Formats the postgres records into an API stats/aggregate response
   *
   * @param {Record<string, Aggregate>} result - the postgres query results
   * @returns {ApiAggregateResult} the api object with the aggregate statistics
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
        field: `${this.queryStringParameters.field}`,
      },
      count: responses,
    };
  }

  /**
   * Formats the postgres results into an API stats/summary response
   *
   * @param {TotalSummary} result - the knex summary query results
   * @returns {SummaryResult} the api object with the summary statistics
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
   * @param {Knex} sendKnex - the knex client to be used
   * @returns {Promise<SummaryResult>} the postgres aggregations based on query
   */
  public async summary(sendKnex: Knex): Promise<SummaryResult> {
    const knex = sendKnex ?? await getKnexClient();
    const aggregateQuery: Knex.QueryBuilder = knex(this.tableName);
    this.buildRangeQuery({ searchQuery: aggregateQuery });
    aggregateQuery.select(
      knex.raw(`COUNT(CASE WHEN ${this.tableName}.error ->> 'Error' is not null THEN 1 END) AS count_errors`),
      knex.raw(`COUNT(${this.tableName}.cumulus_id) AS count_granules`),
      knex.raw(`AVG(${this.tableName}.duration) AS avg_processing_time`),
      knex.raw(`COUNT(DISTINCT ${this.tableName}.collection_cumulus_id) AS count_collections`)
    );
    const aggregateQueryRes: TotalSummary[] = await aggregateQuery;
    return this.formatSummaryResult(aggregateQueryRes[0]);
  }

  /**
   * Performs joins on the provider and/or collection table if neccessary
   *
   * @param {Knex.QueryBuilder} query - the knex query to be joined or not
   */
  private joinTables(query: Knex.QueryBuilder) {
    if (this.queryStringParameters.collectionId) {
      query.join(`${TableNames.collections}`, `${this.tableName}.collection_cumulus_id`, 'collections.cumulus_id');
    }

    if (this.queryStringParameters.provider) {
      query.join(`${TableNames.providers}`, `${this.tableName}.provider_cumulus_id`, 'providers.cumulus_id');
    }
  }

  /**
   * Aggregates the search query based on queryStringParameters
   *
   * @param {Knex.QueryBuilder} query - the knex query to be aggregated
   * @param {Knex} knex - the knex client to be used
   */
  private aggregateQueryField(query: Knex.QueryBuilder, knex: Knex) {
    if (this.queryStringParameters.field?.includes('error.Error')) {
      query.select(knex.raw("error ->> 'Error' as aggregatedfield"));
    } else {
      query.select(`${this.tableName}.${this.queryStringParameters.field} as aggregatedfield`);
    }
    query.modify((queryBuilder) => this.joinTables(queryBuilder))
      .count(`${this.tableName}.cumulus_id as count`)
      .groupBy('aggregatedfield')
      .orderBy([{ column: 'count', order: 'desc' }, { column: 'aggregatedfield' }]);
  }

  /**
   * Builds basic query
   *
   * @param {Knex} knex - the knex client
   * @returns the search query
   */
  protected buildBasicQuery(knex: Knex)
    : {
      searchQuery: Knex.QueryBuilder,
    } {
    const searchQuery:Knex.QueryBuilder = knex(`${this.tableName}`);
    this.aggregateQueryField(searchQuery, knex);
    return { searchQuery };
  }

  /**
   * Builds queries for infix and prefix
   *
   * @param params
   * @param {Knex.QueryBuilder} params.searchQuery - the search query
   * @param [params.dbQueryParameters] - the db query parameters
   */
  protected buildInfixPrefixQuery(params: {
    searchQuery: Knex.QueryBuilder,
    dbQueryParameters?: DbQueryParameters,
  }) {
    const { searchQuery, dbQueryParameters } = params;
    const { infix, prefix } = dbQueryParameters || this.dbQueryParameters;
    const fieldName = infixMapping[this.tableName];
    if (infix) {
      searchQuery.whereLike(`${this.tableName}.${fieldName}`, `%${infix}%`);
    }
    if (prefix) {
      searchQuery.whereLike(`${this.tableName}.${fieldName}`, `%${prefix}%`);
    }
  }

  /**
   * Builds queries for term fields
   *
   * @param params
   * @param {Knex.QueryBuilder} params.searchQuery - the search query
   * @param [params.dbQueryParameters] - the db query parameters
   * @returns {Knex.QueryBuilder} - the updated search query based on queryStringParams
   */
  protected buildTermQuery(params: {
    searchQuery: Knex.QueryBuilder,
    dbQueryParameters?: DbQueryParameters,
  }) {
    const { searchQuery } = params;
    if (this.queryStringParameters.collectionId) {
      searchQuery.where(`${TableNames.collections}.name`, '=', this.queryStringParameters.collectionId);
    }
    if (this.queryStringParameters.provider) {
      searchQuery.where(`${TableNames.providers}.name`, '=', this.queryStringParameters.provider);
    }
    if (this.queryStringParameters.field?.includes('error.Error')) {
      searchQuery.whereRaw(`${this.tableName}.error ->> 'Error' is not null`);
    }
    const { term = {} } = this.dbQueryParameters;
    return super.buildTermQuery({
      ...params,
      dbQueryParameters: { term: omit(term, ['collectionName', 'collectionVersion', 'pdrName', 'error.Error', 'providerName']) },
    });
  }

  /**
   * Executes the aggregate search query
   *
   * @param {Knex | undefined} testKnex - the knex client to be used
   * @returns {Promise<ApiAggregateResult>} - the aggregate query results in api format
   */
  async aggregate(testKnex: Knex | undefined): Promise<ApiAggregateResult> {
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
