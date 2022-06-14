'use strict';

const { Search } = require('./search');
const {
  defaultESScrollSize,
  defaultESScrollDuration,
} = require('./esDefaults');

/**
 * Scroll wrapper class for Search
 *
 * This class just allows a user to access the scroll api of elasticsearch for
 * long lived requests that require multiple server requests.  It is used for
 * reconciliation reporting.
 *
 * Use: Instantiate a class with the queryStringParameters, type, and index.
 * and call the object.query() until no more results are returned.
 *
 * process.env.ES_SCROLL_SIZE = 15;
 *
 * const ess = new ESScrollSearch({
 *   queryStringParameters: {
 *     fields: ['files', 'granuleId'],
 *     'files.bucket.keyword': 'bucketname'
 *   },
 *   'granule',
 *   process.env.ES_INDEX
 * });
 *
 * while (aResult.length > 0) {
 *   aResult = await ess.query();
 *   results = results.concat(aResult);
 * }
 *
 *
 */
class ESScrollSearch extends Search {
  async query(searchContext) {
    if (!this.client) {
      this.client = await super.constructor.es();
    }
    let response;
    if (!this.scrollId && !searchContext) {
      const searchParams = this._buildSearch();
      // this.params.limit exists for API invocation vs. not for reconciliation usage
      searchParams.size = Number(this.params.limit ? this.size : (process.env.ES_SCROLL_SIZE || defaultESScrollSize));
      searchParams.scroll = process.env.ES_SCROLL || defaultESScrollDuration;
      response = await this.client.search(searchParams);
      this.scrollId = response.body._scroll_id;
    } else {
      response = await this.client.scroll({
        scrollId: searchContext || this.scrollId,
        scroll: process.env.ES_SCROLL || defaultESScrollDuration,
      });
      this.scrollId = response.body._scroll_id;
    }

    const meta = this._metaTemplate();
    meta.searchContext = this.scrollId;
    meta.count = response.body.hits.total;
    meta.page = this.page;

    return {
      meta,
      results: (response.body.hits.hits.length > 0) ? response.body.hits.hits.map((s) => s._source) : [],
    };
  }
}

module.exports = ESScrollSearch;
