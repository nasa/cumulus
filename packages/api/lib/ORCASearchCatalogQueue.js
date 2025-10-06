const Logger = require('@cumulus/logger');
const { errorify } = require('@cumulus/errors');
const { postRequestToOrca } = require('./orca');

const log = new Logger({ sender: '@cumulus/api' });

class ORCASearchCatalogQueue {
  constructor(params) {
    this.items = [];
    this.params = { pageIndex: 0, ...params };
  }

  /**
   * Drain all values from the searchQueue, and return to the user.
   * Warning: This can be very memory intensive.
   *
   * @returns {Promise<Array>} array of search results.
   */
  async empty() {
    let result;
    const results = [];
    do {
      result = await this.shift(); // eslint-disable-line no-await-in-loop
      if (result) {
        results.push(result);
      }
    } while (result);
    return results;
  }

  /**
   * View the next item in the queue
   *
   * This does not remove the object from the queue.  When there are no more
   * items in the queue, returns 'null'.
   *
   * @returns {Promise<Object>} an item from the ORCA search
   */
  async peek() {
    if (this.items.length === 0) await this.fetchItems();
    return this.items[0];
  }

  /**
   * Remove the next item from the queue
   *
   * When there are no more items in the queue, returns `null`.
   *
   * @returns {Promise<Object>} an item from the ORCA search
   */
  async shift() {
    if (this.items.length === 0) await this.fetchItems();
    return this.items.shift();
  }

  async searchOrca() {
    let response;
    try {
      response = await postRequestToOrca({
        path: 'catalog/reconcile',
        body: this.params,
      });
    } catch (error) {
      log.error(`Error posting ORCA catalog/reconcile with search params ${JSON.stringify(this.params)}`);
      log.error(errorify(error));
      throw error;
    }

    const { statusCode, body } = response;
    if (statusCode !== 200) {
      const errMsg = `Error searching ORCA catalog/reconcile with search params ${JSON.stringify(this.params)}, `
        + `postRequestToOrca failed ${statusCode}: ${JSON.stringify(body)}`;
      log.error(errMsg);
      throw new Error(errMsg);
    }
    return body;
  }

  /**
   * Query the ORCA API to get the next batch of items
   *
   * @returns {Promise<undefined>} resolves when the queue has been updated
   * @private
   */
  async fetchItems() {
    const result = await this.searchOrca();
    this.items = result.granules;
    // eslint-disable-next-line unicorn/no-null
    if (result.granules.length === 0 || !result.anotherPage) this.items.push(null);

    this.params.pageIndex += 1;
  }
}

module.exports = ORCASearchCatalogQueue;
