const { Search } = require('./search');

/**
 * ES search_after wrapper class for Search.
 * 
 * This class just allows a user to access the search_after api of elasticsearch for
 * long lived requests that require multiple server requests.
 * 
 * Use: Instantiate a class with the queryStringParameters, type, and index.
 * and call the object.query() until no more results are returned.
 * 
 * 
 */
class ESSearchAfter extends Search {
  _buildSearch(searchContext) {
    const params = super._buildSearch();

    if (searchContext) {
      params.body.search_after = searchContext;
    }

    return params;
  }

  async query(searchContext) {
    if (!this.client) {
      this.client = await super.constructor.es();
    }
    const searchParams = this._buildSearch(searchContext);
    const response = await this.client.search(searchParams);
    const hits = (response.body.hits.hits.length > 0) ? response.body.hits.hits : []

    const meta = this._metaTemplate();
    meta.count = response.body.hits.total;
    meta.page = this.page;
    if (hits.length > 0) {
      meta.searchContext = hits[hits.length - 1].sort;
    }

    return {
      meta,
      results: hits.map((s) => s._source),
    };
  }
}

module.exports = ESSearchAfter;
