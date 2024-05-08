//@ts-nocheck
import { Knex } from 'knex';
import { getKnexClient } from '../connection';

class StatsSearch {
  queryStringParameters: Object = {};

  constructor(queryStringParameters: Object) {
    this.queryStringParameters = queryStringParameters;
  }

  private formatAggregateResult(result: any): any {
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

  private formatSummaryResult(result: any): any {
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
   * @returns {Promise<any>} An Object with the summary statistics
   */
  public async summary(sendknex: Knex): Promise<any> {
    const knex = sendknex ?? await getKnexClient();
    let aggregateQuery = knex('granules');
    if (this.queryStringParameters.timestamp__from) {
      aggregateQuery.where('granules.updated_at', '>=', new Date(Number.parseInt(this.queryStringParameters.timestamp__from, 10)));
    }
    if (this.queryStringParameters.timestamp__to) {
      aggregateQuery.where('granules.updated_at', '<=', new Date(Number.parseInt(this.queryStringParameters.timestamp__to, 10)));
    }
    aggregateQuery = await aggregateQuery.select(
      knex.raw("COUNT(CASE WHEN error ->> 'Error' != '{}' THEN 1 END) AS count_errors"),
      knex.raw('COUNT(cumulus_id) AS count_granules'),
      knex.raw('AVG(time_to_process) AS avg_processing_time'),
      knex.raw('COUNT(DISTINCT collection_cumulus_id) AS count_collections')
    );
    const result = aggregateQuery;
    return this.formatSummaryResult(result[0]);
  }

  /** Performs joins on the provider/collection table if neccessary
   *
   * @param {Knex} knex - the knex client to be used
   * @returns {any} Returns the knex query of a joined table or not based on queryStringParameters
   */
  private providerAndCollectionIdBuilder(knex: Knex): any {
    const aggregateQuery = knex.select(
      this.whatToGroupBy(this.queryStringParameters.field, knex)
    ).from(`${this.queryStringParameters.type}`);

    if (this.queryStringParameters.collectionId) {
      aggregateQuery.join('collections', `${this.queryStringParameters.type}.collection_cumulus_id`, 'collections.cumulus_id');
    }

    if (this.queryStringParameters.provider) {
      aggregateQuery.join('providers', `${this.queryStringParameters.type}.provider_cumulus_id`, 'providers.cumulus_id');
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
      groupStrings += ('*', knex.raw("error #>> '{Error, keyword}' as error"), knex.raw('COUNT(*) as count'));
    } else {
      groupStrings += (` ${this.queryStringParameters.field}`);
    }
    return groupStrings;
  }

  /** Provides a knex raw string to aggregate the query based on queryStringParameters
   *
   * @param {query} any - the current knex query to be aggregated
   * @param {Knex} knex - the knex client to be used
   * @returns {any} The query with its new Aggregatation string
   */
  private aggregateQueryField(query: any, knex: Knex): any {
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
   * @returns {Promise<any>} Aggregated results based on queryStringParameters
   */
  public async aggregate_search(sendKnex: Knex): Promise<any> {
    if (this.queryStringParameters !== {}) {
      let aggregateQuery;
      const knex = sendKnex ?? await getKnexClient();
      if (this.queryStringParameters.provider || this.queryStringParameters.collectionId) {
        aggregateQuery = this.providerAndCollectionIdBuilder(knex);
      } else {
        aggregateQuery = knex(`${this.queryStringParameters.type}`);
      }

      if (this.queryStringParameters.collectionId) {
        aggregateQuery.where('collections.name', '=', this.queryStringParameters.collectionId);
      }
      if (this.queryStringParameters.provider) {
        aggregateQuery.where('providers.name', '=', this.queryStringParameters.provider);
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
        r = r.filter((rec) => (rec.status === this.queryStringParameters.status)).map(
          (rec) => ({ count: rec.count })
        );
      }
      /***getting query results*/
      return this.formatAggregateResult(r);
    }
    return undefined;
  }
}

export { StatsSearch };
