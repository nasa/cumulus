const awsServices = require('./services');

// Class to efficiently list all of the objects in an S3 bucket, without loading
// them all into memory at once.  Handles paging of listS3ObjectsV2 requests.
class S3ListObjectsV2Queue {
  constructor(params) {
    this.items = [];
    this.params = params;
    this.s3 = awsServices.s3();
  }

  /**
   * View the next item in the queue
   *
   * This does not remove the object from the queue.  When there are no more
   * items in the queue, returns 'null'.
   *
   * @returns {Promise<Object>} - an S3 object description
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
   * @returns {Promise<Object>} - an S3 object description
   */
  async shift() {
    if (this.items.length === 0) await this.fetchItems();
    return this.items.shift();
  }

  /**
   * Query the S3 API to get the next 1,000 items
   *
   * @returns {Promise<undefined>} - resolves when the queue has been updated
   * @private
   */
  async fetchItems() {
    const response = await this.s3.listObjectsV2(this.params).promise();

    this.items = response.Contents;

    if (response.IsTruncated) {
      this.params.ContinuationToken = response.NextContinuationToken;
    } else this.items.push(null);
  }
}

module.exports = S3ListObjectsV2Queue;
