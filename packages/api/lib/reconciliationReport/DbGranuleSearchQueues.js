'use strict';

const flatten = require('lodash/flatten');
const isNil = require('lodash/isNil');
const { Granule } = require('../../models');

/**
 * Class to create granule search queues and iterate the items in the queues, items retrieved
 * are ordered by granuleId.
 *
 * If there are granuleIds in the filter, create search queues for each granuleId in order to
 * 'query' the table, otherwise, create only one queue.  The queue created with the granuleId
 * has 0 or 1 item.
 */
class DbGranuleSearchQueues {
  constructor(collectionId, searchParams) {
    const { granuleId: granuleIds, queryParams } = searchParams;
    if (granuleIds) {
      this.queues = granuleIds.sort().map((granuleId) => new Granule()
        .searchGranulesForCollection(collectionId, { ...queryParams, granuleId }));
    } else {
      this.queues = [new Granule().searchGranulesForCollection(collectionId, searchParams)];
    }
    this.currentQueue = this.queues.shift();
  }

  /**
   * retrieve the queue which has items
   *
   * @returns {Promise<Object>} the granules' queue
   */
  async retrieveQueue() {
    let item = await this.currentQueue.peek();
    while (isNil(item) && this.queues.length > 0) {
      this.currentQueue = this.queues.shift();
      item = await this.currentQueue.peek(); //eslint-disable-line no-await-in-loop
    }
    return this.currentQueue;
  }

  /**
   * view the next item in the queues
   *
   * @returns {Promise<Object>} an item from the table
   */
  async peek() {
    const queue = await this.retrieveQueue();
    return queue ? queue.peek() : undefined;
  }

  /**
   * Remove the next item from the queue
   *
   * @returns {Promise<Object>} an item from the table
   */
  async shift() {
    const queue = await this.retrieveQueue();
    return queue ? queue.shift() : undefined;
  }

  /**
   * Drain all values from the queues
   *
   * @returns {Promise<Array>} array of search results.
   */
  async empty() {
    const items = await Promise.all(this.queues.map((queue) => queue.empty()));
    return flatten(items);
  }
}

exports.DbGranuleSearchQueues = DbGranuleSearchQueues;
