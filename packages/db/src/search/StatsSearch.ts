import { Knex } from 'knex';
import { getKnexClient } from '../connection';
import { TableNames } from '../tables';
import { DbQueryParameters } from '../types/search';
import { BaseSearch, typeToTable } from './BaseSearch';

type TotalSummaryObject = {
  count_errors: number,
  count_collections: number,
  count_granules: number,
  avg_processing_time: number,
};

type AggregateObject = {
  count: string,
  status?: string,
  error?: string,
  name?: string,
};

type SummaryObject = {
  dateFrom: string | Date,
  dateTo: string | Date,
  value: number,
  aggregation: string,
  unit: string,
};

type SummaryResultObject = {
  errors: SummaryObject,
  granules: SummaryObject,
  collections: SummaryObject,
  processingTime: SummaryObject,
};

type MetaObject = {
  name: string,
  count: number,
  field: string,
};

type AggregateResObject = {
  key: string,
  count: number,
};

type ApiAggregateResult = {
  meta: MetaObject,
  count: AggregateResObject[]
};

const infixMapping = new Map([
  ['granules', 'granule_id'],
  ['collections', 'name'],
  ['providers', 'name'],
  ['executions', 'arn'],
  ['pdrs', 'name'],
]);

class StatsSearch extends BaseSearch {
  /** Formats the knex results into an API aggregate search response
   *
   * @param {Record<string, aggregateObject>} result - the knex query results
   * @returns {apiAggregateResult} An api Object with the aggregate statistics
   */
  private formatAggregateResult(result: Record<string, AggregateObject>): ApiAggregateResult {
    let totalCount = 0;
    const responses = [];
    for (const row of Object.keys(result)) {
      responses.push(
        {
          key: this.queryStringParameters.field === 'status' ? `${result[row].status}` :
            (this.queryStringParameters.field?.includes('error.Error') ? `${result[row].error}` : `${result[row].name}`),
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

  /** Formats the knex results into an API aggregate search response
   *
   * @param {totalSummaryObject} result - the knex summary query results
   * @returns {SummaryResultObject} An api Object with the summary statistics
   */
  private formatSummaryResult(result: TotalSummaryObject): SummaryResultObject {
    const timestampTo = Number.parseInt(this.queryStringParameters.timestamp__to as string, 10);
    const timestampFrom = Number.parseInt(this.queryStringParameters.timestamp__from as string, 10);
    const dateto = this.queryStringParameters.timestamp__to ?
      new Date(timestampTo) : new Date();
    const datefrom = this.queryStringParameters.timestamp__from ?
      new Date(timestampFrom) : '1970-01-01T12:00:00+00:00';
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

  /** Provides a summary of statistics around the granules in the system
   *
   * @param {Knex} sendKnex - the knex client to be used
   * @returns {Promis<SummaryResultObject>} An Object with the summary statistics
   */
  public async summary(sendknex: Knex): Promise<SummaryResultObject> {
    const knex = sendknex ?? await getKnexClient();
    const aggregateQuery:Knex.QueryBuilder = knex(`${TableNames.granules}`);
    if (this.queryStringParameters.timestamp__from) {
      aggregateQuery.where(`${TableNames.granules}.updated_at`, '>=', new Date(Number.parseInt(this.queryStringParameters.timestamp__from as string, 10)));
    }
    if (this.queryStringParameters.timestamp__to) {
      aggregateQuery.where(`${TableNames.granules}.updated_at`, '<=', new Date(Number.parseInt(this.queryStringParameters.timestamp__to as string, 10)));
    }
    aggregateQuery.select(
      knex.raw(`COUNT(CASE WHEN ${TableNames.granules}.error ->> 'Error' != '{}' THEN 1 END) AS count_errors`),
      knex.raw(`COUNT(${TableNames.granules}.cumulus_id) AS count_granules`),
      knex.raw(`AVG(${TableNames.granules}.duration) AS avg_processing_time`),
      knex.raw(`COUNT(DISTINCT ${TableNames.granules}.collection_cumulus_id) AS count_collections`)
    );
    const aggregateQueryRes: TotalSummaryObject[] = await aggregateQuery;
    return this.formatSummaryResult(aggregateQueryRes[0]);
  }

  /** Performs joins on the provider/collection table if neccessary
   *
   * @param {Knex} knex - the knex client to be used
   * @returns {Knex.QueryBuilder} the knex query of a joined table or not based on queryStringParams
   */
  private providerAndCollectionIdBuilder(knex: Knex): Knex.QueryBuilder {
    let aggregateQuery;
    this.queryStringParameters.field = this.queryStringParameters.field ? this.queryStringParameters.field : 'status';
    if (this.queryStringParameters.field?.includes('error.Error')) {
      aggregateQuery = knex.select(knex.raw("error #>> '{Error, keyword}' as error")).from(typeToTable[this.type]);
    } else {
      aggregateQuery = knex.select(`${typeToTable[this.type]}.${this.queryStringParameters.field}`).from(typeToTable[this.type]);
    }
    if (this.queryStringParameters.collectionId) {
      aggregateQuery.join(`${TableNames.collections}`, `${typeToTable[this.type]}.collection_cumulus_id`, 'collections.cumulus_id');
    }

    if (this.queryStringParameters.provider) {
      aggregateQuery.join(`${TableNames.providers}`, `${typeToTable[this.type]}.provider_cumulus_id`, 'providers.cumulus_id');
    }
    return aggregateQuery;
  }

  /** Provides a knex raw string to aggregate the query based on queryStringParameters
   *
   * @param {query} Knex.QueryBuilder - the current knex query to be aggregated
   * @param {Knex} knex - the knex client to be used
   * @returns {Knex.QueryBuilder} The query with its new Aggregatation string
   */
  private aggregateQueryField(query: Knex.QueryBuilder, knex: Knex): Knex.QueryBuilder {
    this.queryStringParameters.field = this.queryStringParameters.field ? this.queryStringParameters.field : 'status';
    if (this.queryStringParameters.field?.includes('error.Error')) {
      query.select(knex.raw("error #>> '{Error, keyword}' as error"))
        .count('* as count')
        .groupByRaw(knex.raw("error #>> '{Error, keyword}'"))
        .orderBy('count', 'desc');
    } else {
      query.select(`${typeToTable[this.type]}.${this.queryStringParameters.field}`)
        .count('* as count')
        .groupBy(`${typeToTable[this.type]}.${this.queryStringParameters.field}`)
        .orderBy('count', 'desc');
    }
    return query;
  }

  protected buildBasicQuery(knex: Knex)
    : {
      searchQuery: Knex.QueryBuilder,
    } {
    let searchQuery:Knex.QueryBuilder;
    if (this.queryStringParameters.provider || this.queryStringParameters.collectionId) {
      searchQuery = this.providerAndCollectionIdBuilder(knex);
    } else {
      searchQuery = knex(`${typeToTable[this.type]}`);
    }
    searchQuery = this.aggregateQueryField(searchQuery, knex);
    return { searchQuery };
  }

  protected buildInfixPrefixQuery(params: {
    searchQuery: Knex.QueryBuilder,
    dbQueryParameters?: DbQueryParameters,
  }) {
    const { searchQuery, dbQueryParameters } = params;
    const { infix, prefix } = dbQueryParameters || this.dbQueryParameters;
    const fieldName = typeToTable[this.type] ? infixMapping.get(typeToTable[this.type]) : 'granuleId';
    if (infix) {
      searchQuery.whereLike(`${typeToTable[this.type]}.${fieldName}`, `%${infix}%`);
    }
    if (prefix) {
      searchQuery.whereLike(`${typeToTable[this.type]}.${fieldName}`, `%${prefix}%`);
    }
  }

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
    if (this.queryStringParameters.timestamp__from) {
      searchQuery.where(`${typeToTable[this.type]}.updated_at`, '>=', new Date(Number.parseInt(this.queryStringParameters.timestamp__from as string, 10)));
    }
    if (this.queryStringParameters.timestamp__to) {
      searchQuery.where(`${typeToTable[this.type]}.updated_at`, '<=', new Date(Number.parseInt(this.queryStringParameters.timestamp__to as string, 10)));
    }
    if (this.queryStringParameters.status) {
      searchQuery.where(`${typeToTable[this.type]}.status`, '=', this.queryStringParameters.status);
    }
    return { searchQuery };
  }

  async aggregate(testKnex: Knex | undefined) {
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
