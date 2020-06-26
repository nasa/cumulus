'use strict';

const flatten = require('lodash/flatten');
const Logger = require('@cumulus/logger');
const { Search, defaultIndexAlias } = require('./search');

const log = new Logger({ sender: '@api/es/esFileSearchQueue' });

const defaultESScrollSize = 1000;
const defaultESScrollDuration = '30s';

const logAndToss = (error) => {
  log.error(JSON.stringify(error));
  throw error;
};

/**
 * Returns a function that returns truthyness value that an object has a key:bucket
 * that matches the input `bucket`.
 *
 * @param {string} bucket - bucket to build a filter for.
 * @returns {Function} - filter function
 */
const sameBucket = (bucket) => (object) =>
  object.bucket && object.bucket === bucket;

/**
 * Given the Elasticsearch response, transform the array into an array of new
 * objects where only files in the desired bucket are included and the
 * granuleId is added.
 *
 * @param {Array<Object>} granuleFilesList - array of Elasticsearch results hits
 * @param {string} bucket - bucket to include in results.
 * @returns {Array<Object>}
 */
const buildFilesResponse = (granuleFilesList, bucket) =>
  flatten(
    granuleFilesList.map((gfl) =>
      gfl.files.filter(sameBucket(bucket)).map((object) => ({
        granuleId: gfl.granuleId,
        ...object
      })))
  );

class ESFileSearchQueue {
  constructor({ bucket, esIndex }) {
    this.items = [];
    this.bucket = bucket;
    this.params = {
      index: esIndex || process.env.ES_INDEX || defaultIndexAlias,
      type: 'granule',
      size: process.env.ES_SCROLL_SIZE || defaultESScrollSize,
      scroll: defaultESScrollDuration,
      _source: ['files', 'granuleId'],
      body: {
        query: {
          term: {
            'files.bucket.keyword': {
              value: `${bucket}`
            }
          }
        },
        sort: [
          {
            'files.key.keyword': {
              order: 'asc',
              unmapped_type: 'keyword'
            }
          }
        ]
      }
    };
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
    if (!this.esClient) {
      this.esClient = await Search.es();
    }

    let response;
    if (!this.scrollId) {
      response = await this.esClient
        .search(this.params)
        .then((searchResponse) => searchResponse.body)
        .catch(logAndToss);
    } else {
      response = await this.esClient
        .scroll({
          scrollId: this.scrollId,
          scroll: defaultESScrollDuration
        })
        .then((searchResponse) => searchResponse.body)
        .catch(logAndToss);
    }
    this.scrollId = response._scroll_id;
    const granuleFilesList = response.hits.hits.map((s) => s._source);
    this.items = buildFilesResponse(granuleFilesList, this.bucket);
  }
}

module.exports = { ESFileSearchQueue };
