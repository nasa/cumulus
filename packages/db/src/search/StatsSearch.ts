//@ts-nocheck
import { Knex } from 'knex';
import { getKnexClient } from '../connection';

class StatsSearch {
  query: String;

  matches: any = {
    field: /[&?]field=([^&]+)/,
    from: /[&?]timestamp__from=([^&]+)/,
    to: /[&?]timestamp__to=([^&]+)/,
    type: /[&?]type=([^&]+)/,
    collection_id: /[&?]collection_id=([^&]+)/,
    provider_id: /[&?]provider_id=([^&]+)/,
  };

  constructor(statsQuery: string) {
    this.query = statsQuery;
  }

  public async aggregate_search(sendKnex: Knex): Promise<any> {
    if (this.query !== null || this.query !== undefined) {
      const knex = sendKnex ?? await getKnexClient();
      const queryType = (this.query).match(this.matches.type) ?
        (this.query).match(this.matches.type)[1] : 'granules'; // what table to query
      const queryFrom = (this.query).match(this.matches.from) ?
        (this.query).match(this.matches.from)[1] : undefined; //range lower bound
      const queryTo = (this.query).match(this.matches.to) ?
        (this.query).match(this.matches.to)[1] : undefined; //range upper bound
      const queryCollectionId = (this.query).match(this.matches.collection_id) ?
        (this.query).match(this.matches.collection_id)[1] : undefined; //collectionId if exists
      const queryProvider = (this.query).match(this.matches.provider_id) ?
        (this.query).match(this.matches.provider_id)[1] : undefined; //provider if exists
      const queryField = (this.query).match(this.matches.field) ? (this.query).match(this.matches.field)[1] : 'status';
      let r;
      // need to figure out the KNEX conversion for the nested error type queries
      // query builder
      let aggregateQuery;
      if (queryType) {
        aggregateQuery = knex(`${queryType}`)
          .select(`${queryField}`)
          .count('* as count')
          .groupBy(`${queryField}`)
          .orderBy('count', 'desc');
        if (queryCollectionId) {
          aggregateQuery = aggregateQuery.where(
            'collection_cumulus_id',
            '=',
            queryCollectionId
          );
        }
        if (queryTo) {
          aggregateQuery = aggregateQuery.where(
            'ending_date_time',
            '>=',
            new Date(Number.parseInt(queryTo, 10))
          );
        }
        if (queryFrom) {
          aggregateQuery = aggregateQuery.where(
            'beginning_date_time',
            '<=',
            new Date(Number.parseInt(queryFrom, 10))
          );
        }
        if (queryProvider) {
          aggregateQuery = aggregateQuery.where(
            'provider_cumulus_id',
            '=',
            queryProvider
          );
        }
        const result = await knex.raw(aggregateQuery.toString());
        r = result.rows;
      }
      /***getting query results*/
      return r;
    }
    return undefined;
  }
}

export { StatsSearch };
