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
    collection_id: /[&?]collectionId=([^&]+)/,
    provider_id: /[&?]providerId=([^&]+)/,
  };

  constructor(statsQuery: string) {
    this.query = statsQuery;
  }

  public async aggregate_search(sendKnex: Knex): Promise<any> {
    if (this.query) {
      let aggregateQuery;
      const knex = sendKnex ?? await getKnexClient();
      const queryType = (this.query).match(this.matches.type) ?
        (this.query).match(this.matches.type)[1] : 'granules'; // what table to query
      const queryFrom = (this.query).match(this.matches.from) ?
        (this.query).match(this.matches.from)[1] : undefined; //range lower bound
      const queryTo = (this.query).match(this.matches.to) ?
        (this.query).match(this.matches.to)[1] : undefined; //range upper bound
      const queryCollectionId = (this.query).match(this.matches.collection_id) ?
        (this.query).match(this.matches.collection_id)[1] : undefined; //collection NAME
      const queryProvider = (this.query).match(this.matches.provider_id) ?
        (this.query).match(this.matches.provider_id)[1] : undefined; //provider NAME
      const queryField = (this.query).match(this.matches.field) ? (this.query).match(this.matches.field)[1] : 'status';
      const dateQueryStringTo = queryType === 'granules' ? 'ending_date_time' : 'updated_at';
      const dateQueryStringFrom = queryType === 'granules' ? 'beginning_date_time' : 'created_at';

      if (queryField.includes('error.Error')) {
        aggregateQuery = knex(`${queryType}`).select(knex.raw("error #>> '{Error, keyword}' as error"), knex.raw("COUNT(*) as count")).groupByRaw("error #>> '{Error, keyword}'").orderBy('count', 'desc');
      } else {
        aggregateQuery = knex(`${queryType}`).select(`${queryField}`).count('* as count').groupBy(`${queryField}`)
          .orderBy('count', 'desc');
      }
      // query builder
      if (queryCollectionId) {
        aggregateQuery = aggregateQuery.where('collection_cumulus_id', '=', queryCollectionId);
      }
      if (queryTo) {
        aggregateQuery = aggregateQuery.where(dateQueryStringTo, '>', new Date(Number.parseInt(queryTo, 10)));
      }
      if (queryFrom) {
        aggregateQuery = aggregateQuery.where(dateQueryStringFrom, '<', new Date(Number.parseInt(queryFrom, 10)));
      }
      if (queryProvider) {
        aggregateQuery = aggregateQuery.where('provider_cumulus_id', '=', queryProvider);
      }
      const result = await knex.raw(aggregateQuery.toString());
      const r = result.rows;
      /***getting query results*/
      return r;
    }
    return undefined;
  }
}

export { StatsSearch };
