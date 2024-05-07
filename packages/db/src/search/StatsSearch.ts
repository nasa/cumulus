//@ts-nocheck
import { Knex } from 'knex';
import { getKnexClient } from '../connection';

class StatsSearch {
  queryStringParameters: Object = {};

  constructor(queryStringParameters: Object) {
    this.queryStringParameters = queryStringParameters;
  }

  /** Updates the knex query to filter by time ranges if applicable
   *
   * @param {any} query - the current knex query before time filters
   * @param {string} queryField - updated_at or created_at string
   * @returns {any} The updated query based on time filters
   */
  public handleTime(query: any, queryField: any): any {
    return query.whereBetween(
      `${this.queryStringParameters.type}.${queryField}`,
      [new Date(Number.parseInt(this.queryStringParameters.timestamp__from, 10)),
        new Date(Number.parseInt(this.queryStringParameters.timestamp__to, 10))]
    );
  }

  /** Provides a summary of statistics around the granules in the system
   *
   * @param {Knex} sendKnex - the knex client to be used
   * @returns {Promise<any>} An Object with the summary statistics
   */
  public async summary(sendknex: Knex): Promise<any> {
    const knex = sendknex ?? await getKnexClient();
    this.queryStringParameters.type = 'granules';
    let aggregateQuery = knex('granules');
    if (this.queryStringParameters.timestamp__to) {
      aggregateQuery = this.handleTime(knex('granules'), 'updated_at');
    }
    if (this.queryStringParameters.timestamp__from) {
      aggregateQuery = this.handleTime(aggregateQuery, 'created_at');
    }
    aggregateQuery = await aggregateQuery.select(
      knex.raw("COUNT(CASE WHEN error ->> 'Error' != '{}' THEN 1 END) AS count_errors"),
      knex.raw('COUNT(cumulus_id) AS count_granules'),
      knex.raw('AVG(time_to_process) AS avg_processing_time'),
      knex.raw('COUNT(DISTINCT collection_cumulus_id) AS count_collections')
    );
    const result = aggregateQuery;
    return result;
  }

  /** Performs joins on the provider/collection table if neccessary
   *
   * @param {Knex} knex - the knex client to be used
   * @returns {any} Returns the knex query of a joined table or not based on queryStringParameters
   */
  public providerAndCollectionIdBuilder(knex: Knex): any {
    let aggregateQuery = knex.select(
      this.whatToGroupBy(this.queryStringParameters.field, knex)
    ).from(`${this.queryStringParameters.type}`);

    if (this.queryStringParameters.collectionId) {
      aggregateQuery = aggregateQuery.join('collections', `${this.queryStringParameters.type}.collection_cumulus_id`, 'collections.cumulus_id');
    }

    if (this.queryStringParameters.providerId) {
      aggregateQuery = aggregateQuery.join('providers', `${this.queryStringParameters.type}.provider_cumulus_id`, 'providers.cumulus_id');
    }
    return aggregateQuery;
  }

  /** Provides a knex raw string to group the query based on queryStringParameters
   *
   * @param {Knex} knex - the knex client to be used
   * @returns {string} The elements to GroupBy
   */
  public whatToGroupBy(knex: Knex): string {
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
  public aggregateQueryField(query: any, knex: Knex): any {
    let tempQuery = '';
    if (this.queryStringParameters.field.includes('error.Error')) {
      tempQuery = query.select(knex.raw("error #>> '{Error, keyword}' as error"), knex.raw('COUNT(*) as count')).groupByRaw("error #>> '{Error, keyword}'").orderBy('count', 'desc');
    } else {
      tempQuery = query.select(`${this.queryStringParameters.field}`).count('* as count').groupBy(`${this.queryStringParameters.field}`)
        .orderBy('count', 'desc');
    }
    return tempQuery;
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
      if (this.queryStringParameters.providerId || this.queryStringParameters.collectionId) {
        aggregateQuery = this.providerAndCollectionIdBuilder(knex);
      } else {
        aggregateQuery = knex(`${this.queryStringParameters.type}`);
      }

      if (this.queryStringParameters.collectionId) {
        aggregateQuery = aggregateQuery.where('collections.name', '=', this.queryStringParameters.collectionId);
      }
      if (this.queryStringParameters.providerId) {
        aggregateQuery = aggregateQuery.where('providers.name', '=', this.queryStringParameters.providerId);
      }
      if (this.queryStringParameters.timestamp__to) {
        aggregateQuery = this.handleTime(aggregateQuery, 'updated_at');
      }
      if (this.queryStringParameters.timestamp__from) {
        aggregateQuery = this.handleTime(aggregateQuery, 'created_at');
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
      return r;
    }
    return undefined;
  }
}

export { StatsSearch };
