'use strict';

const { defaultIndexAlias } = require('./search');
const ESScrollSearch = require('./esScrollSearch');

// const collection = new Collection(
//   { queryStringParameters: req.query },
//   null,
//   process.env.ES_INDEX
// );
// const result = await collection.query();

const buildResponse = (response) => {
  return response;
};

class ESSearchQueue {
  constructor(queryStringParameters, type = 'collection', esIndex) {
    this.items = [];
    this.type = type;
    this.index = esIndex || process.env.ES_INDEX || defaultIndexAlias;
    this.params = { ...queryStringParameters };
  }

  /**
   * Drain all values from the searchQueue, and return to the user.
   * Warning: This can be very memory intensive.
   *
   * @returns {Promise<Array>} array of search results.
   */
  async empty() {
    let result;
    let results = [];
    /* eslint-disable no-await-in-loop */
    do {
      result = await this.shift();
      if (result) {
        results = results.concat(result);
      }
    } while (result);
    /* eslint-enable no-await-in-loop */
    return results;
  }

  /**
   * View the next item in the Queue.
   *
   * This does not remove the object from the queue.  When there are no more
   * items in the queue, returns 'undefined'.
   *
   * @returns {Promise<Object>} an item from Elasticsearch.
   */
  async peek() {
    if (this.items.length === 0) await this.fetchItems();
    return this.items[0];
  }

  /**
   * Remove the next item from the queue
   *
   * When there are no more items in the queue, returns 'undefined'.
   *
   * @returns {Promise<Object>} an item from the Elasticsearch
   */
  async shift() {
    if (this.items.length === 0) await this.fetchItems();
    return this.items.shift();
  }

  /**
   * A esFileSearchQueue instance stores the list of items to be returned in
   * the `this.items` array. When that list is empty, the `fetchItems()` method
   * is called to repopulate `this.items`.
   */
  async fetchItems() {
    if (!this.scrollClient) {
      this.scrollClient = new ESScrollSearch(
        {
          queryStringParameters: this.params,
        },
        this.type,
        this.index
      );
    }
    const response = await this.scrollClient.query();
    this.items = buildResponse(response);
  }
}

module.exports = { ESSearchQueue };
