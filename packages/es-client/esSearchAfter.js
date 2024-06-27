const { Search } = require('./search');

/**
 * ES search_after wrapper class for Search.
 *
 * This class just allows a user to access the search_after api of elasticsearch for
 * long lived requests that require multiple server requests.
 *
 * Use: Instantiate a class with the queryStringParameters, type, and index.
 * and call the object.query() until no more results are returned.
 */
class ESSearchAfter extends Search {
  /**
   * Build search params for search-after API.
   *
   * @returns {Object} ES search params
   */
  _buildSearch() {
    const params = super._buildSearch();
    delete params.from;
    delete params.to;

    if (this.params.searchContext) {
      // express seems to decode the URI params for us so we don't need to call decodeURIComponent
      params.body.search_after = JSON.parse(this.params.searchContext);
    }
    return params;
  }

  /**
   * Query ES search-after API.
   *
   * @returns {Promise<Object>} Object containing query meta and results
   */
  async query() {
    if (!this._esClient) {
      await this.initializeEsClient();
    }

    const searchParams = this._buildSearch();
    const response = await this.client.search(searchParams);

    const hits = response.body.hits.hits;
    const meta = this._metaTemplate();

    meta.count = response.body.hits.total;
    meta.page = this.page;
    if (hits.length > 0) {
      meta.searchContext = encodeURIComponent(JSON.stringify(hits[hits.length - 1].sort));
    }
    return {
      meta,
      results: hits.map((s) => s._source),
    };
  }
}

module.exports = ESSearchAfter;
