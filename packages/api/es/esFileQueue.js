'use strict';

const flatten = require('lodash/flatten');
const { defaultIndexAlias } = require('./search');
const ESScrollSearch = require('./esScrollSearch');

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

/**
 * Class that returns a queue of files for an input bucket.  Items are returned
 * in the order by the 'Key' attribute.
 */
class ESFileQueue {
  constructor({ bucket, esIndex }) {
    this.items = [];
    this.bucket = bucket;
    this.index = esIndex || process.env.ES_INDEX || defaultIndexAlias;
    this.params = {
      fields: ['files', 'granuleId'],
      'files.bucket.keyword': bucket,
      sortParams: {
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
   * A esFileQueue instance stores the list of items to be returned in
   * the `this.items` array. When that list is empty, the `fetchItems()` method
   * is called to repopulate `this.items`.
   */
  async fetchItems() {
    if (!this.esClient) {
      this.esClient = new ESScrollSearch(
        {
          queryStringParameters: this.params
        },
        'granule',
        this.index
      );
    }
    const response = await this.esClient.query();
    this.items = buildFilesResponse(response, this.bucket);
  }
}

module.exports = { ESFileQueue };
