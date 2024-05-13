import { Knex } from 'knex';
import { getKnexClient } from '../connection';
import { TableNames } from '../tables';

type QueryStringParams = {
  field: string;
  timestamp__to?: string,
  timestamp__from?: string,
  type?: string,
  status?: string,
  collectionId?: string,
  provider?: string,
};

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
};

type SummaryObject = {
  dateFrom: string | Date,
  dateTo: string | Date,
  value: string,
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
  count: string,
  field: string,
};

type AggregateResObject = {
  key: string,
  count: string,
};

type ApiAggregateResult = {
  meta: MetaObject,
  count: AggregateResObject[]
};

class StatsSearch {
  queryStringParameters: QueryStringParams;

  constructor(queryStringParameters: QueryStringParams) {
    this.queryStringParameters = queryStringParameters;
  }

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
          key: this.queryStringParameters.field === 'status' ? `${result[row].status}` : `${result[row].error}`,
          count: `${result[row].count}`,
        }
      );
      totalCount += Number(result[row].count);
    }

    return {
      meta: {
        name: 'cumulus-api',
        count: `${totalCount}`,
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
    const dateto = this.queryStringParameters.timestamp__to ?
      new Date(Number.parseInt(this.queryStringParameters.timestamp__to, 10)) : new Date();
    const datefrom = this.queryStringParameters.timestamp__from ?
      new Date(Number.parseInt(this.queryStringParameters.timestamp__from, 10)) : '1970-01-01T12:00:00+00:00';
    return {
      errors: {
        dateFrom: datefrom,
        dateTo: dateto,
        value: `${result.count_errors}`,
        aggregation: 'count',
        unit: 'error',
      },
      collections: {
        dateFrom: datefrom,
        dateTo: dateto,
        value: `${result.count_collections}`,
        aggregation: 'count',
        unit: 'collection',
      },
      processingTime: {
        dateFrom: datefrom,
        dateTo: dateto,
        value: `${result.avg_processing_time}`,
        aggregation: 'average',
        unit: 'second',
      },
      granules: {
        dateFrom: datefrom,
        dateTo: dateto,
        value: `${result.count_granules}`,
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
      aggregateQuery.where(`${TableNames.granules}.updated_at`, '>=', new Date(Number.parseInt(this.queryStringParameters.timestamp__from, 10)));
    }
    if (this.queryStringParameters.timestamp__to) {
      aggregateQuery.where(`${TableNames.granules}.updated_at`, '<=', new Date(Number.parseInt(this.queryStringParameters.timestamp__to, 10)));
    }
    const aggregateQueryRes: TotalSummaryObject[] = await aggregateQuery.select(
      knex.raw(`COUNT(CASE WHEN ${TableNames.granules}.error ->> 'Error' != '{}' THEN 1 END) AS count_errors`),
      knex.raw(`COUNT(${TableNames.granules}.cumulus_id) AS count_granules`),
      knex.raw(`AVG(${TableNames.granules}.duration) AS avg_processing_time`),
      knex.raw(`COUNT(DISTINCT ${TableNames.granules}.collection_cumulus_id) AS count_collections`)
    );
    return this.formatSummaryResult(aggregateQueryRes[0]);
  }

  /** Performs joins on the provider/collection table if neccessary
   *
   * @param {Knex} knex - the knex client to be used
   * @returns {Knex.QueryBuilder} the knex query of a joined table or not based on queryStringParams
   */
  private providerAndCollectionIdBuilder(knex: Knex): Knex.QueryBuilder {
    const aggregateQuery = knex.select(
      this.whatToGroupBy(knex)
    ).from(`${this.queryStringParameters.type}`);
    if (this.queryStringParameters.collectionId) {
      aggregateQuery.join(`${TableNames.collections}`, `${this.queryStringParameters.type}.collection_cumulus_id`, 'collections.cumulus_id');
    }

    if (this.queryStringParameters.provider) {
      aggregateQuery.join(`${TableNames.providers}`, `${this.queryStringParameters.type}.provider_cumulus_id`, 'providers.cumulus_id');
    }
    return aggregateQuery;
  }

  /** Provides a knex raw string to group the query based on queryStringParameters
   *
   * @param {Knex} knex - the knex client to be used
   * @returns {string} The elements to GroupBy
   */
  private whatToGroupBy(knex: Knex): string {
    let groupStrings = '';
    if (this.queryStringParameters.field.includes('error.Error')) {
      groupStrings = `${groupStrings}*` + (knex.raw("error #>> '{Error, keyword}' as error"), knex.raw('COUNT(*) as count'));
    } else {
      groupStrings += (` ${this.queryStringParameters.field}`);
    }
    return groupStrings;
  }

  /** Provides a knex raw string to aggregate the query based on queryStringParameters
   *
   * @param {query} Knex.QueryBuilder - the current knex query to be aggregated
   * @param {Knex} knex - the knex client to be used
   * @returns {Knex.QueryBuilder} The query with its new Aggregatation string
   */
  private aggregateQueryField(query: Knex.QueryBuilder, knex: Knex): Knex.QueryBuilder {
    if (this.queryStringParameters.field.includes('error.Error')) {
      query.select(knex.raw("error #>> '{Error, keyword}' as error"), knex.raw('COUNT(*) as count')).groupByRaw("error #>> '{Error, keyword}'").orderBy('count', 'desc');
    } else {
      query.select(`${this.queryStringParameters.field}`).count('* as count').groupBy(`${this.queryStringParameters.field}`)
        .orderBy('count', 'desc');
    }
    return query;
  }

  /** Counts the value frequencies for a given field for a given type of record
   *
   * @param {Knex} knex - the knex client to be used
   * @returns {Promise<apiAggregateResult | undefined>} Aggregated results based on query
   */
  public async aggregate(sendKnex: Knex): Promise<ApiAggregateResult | undefined> {
    if (this.queryStringParameters) {
      let aggregateQuery:Knex.QueryBuilder;
      const knex = sendKnex ?? await getKnexClient();
      if (this.queryStringParameters.provider || this.queryStringParameters.collectionId) {
        aggregateQuery = this.providerAndCollectionIdBuilder(knex);
      } else {
        aggregateQuery = knex(`${this.queryStringParameters.type}`);
      }

      if (this.queryStringParameters.collectionId) {
        aggregateQuery.where(`${TableNames.collections}.name`, '=', this.queryStringParameters.collectionId);
      }
      if (this.queryStringParameters.provider) {
        aggregateQuery.where(`${TableNames.providers}.name`, '=', this.queryStringParameters.provider);
      }
      if (this.queryStringParameters.timestamp__from) {
        aggregateQuery.where(`${this.queryStringParameters.type}.updated_at`, '>=', new Date(Number.parseInt(this.queryStringParameters.timestamp__from, 10)));
      }
      if (this.queryStringParameters.timestamp__to) {
        aggregateQuery.where(`${this.queryStringParameters.type}.updated_at`, '<=', new Date(Number.parseInt(this.queryStringParameters.timestamp__to, 10)));
      }
      this.queryStringParameters.field = this.queryStringParameters.field ? this.queryStringParameters.field : 'status';
      aggregateQuery = this.aggregateQueryField(aggregateQuery, knex);

      const result = await knex.raw(aggregateQuery.toString());
      let r = result.rows;
      if (this.queryStringParameters.status) {
        r = r.filter((rec:AggregateObject) =>
          (rec.status === this.queryStringParameters.status)).map(
          (rec:AggregateObject) => ({ count: rec.count })
        );
      }
      /***getting query results*/
      return this.formatAggregateResult(r);
    }
    return undefined;
  }
}

export { StatsSearch };
