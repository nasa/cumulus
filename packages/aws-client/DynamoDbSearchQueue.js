const awsServices = require('./services');

// Class to efficiently search all of the items in a DynamoDB table, without
// loading them all into memory at once.  Handles paging.
class DynamoDbSearchQueue {
  constructor(params, searchType = 'scan') {
    this.items = [];
    this.params = params;
    this.dynamodbDocClient = awsServices.dynamodbDocClient();
    this.searchType = searchType;
  }

  /**
   * View the next item in the queue
   *
   * This does not remove the object from the queue.  When there are no more
   * items in the queue, returns 'null'.
   *
   * @returns {Promise<Object>} - an item from the DynamoDB table
   */
  async peek() {
    if (this.items.length === 0) await this.fetchItems();
    return this.items[0];
  }

  /**
   * Remove the next item from the queue
   *
   * When there are no more items in the queue, returns 'null'.
   *
   * @returns {Promise<Object>} - an item from the DynamoDB table
   */
  async shift() {
    if (this.items.length === 0) await this.fetchItems();
    return this.items.shift();
  }

  /**
   * Query the DynamoDB API to get the next batch of items
   *
   * @returns {Promise<undefined>} - resolves when the queue has been updated
   * @private
   */
  async fetchItems() {
    let response;
    do {
      response = await this.dynamodbDocClient[this.searchType](this.params).promise(); // eslint-disable-line no-await-in-loop, max-len
      if (response.LastEvaluatedKey) this.params.ExclusiveStartKey = response.LastEvaluatedKey;
    } while (response.Items.length === 0 && response.LastEvaluatedKey);

    this.items = response.Items;

    if (!response.LastEvaluatedKey) this.items.push(null);
  }
}

module.exports = DynamoDbSearchQueue;
