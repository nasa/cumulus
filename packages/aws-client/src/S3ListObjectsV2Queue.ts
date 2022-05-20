import {
  ListObjectsV2Request,
  S3,
  _Object,
} from '@aws-sdk/client-s3';
import { s3 } from './services';

/**
 * Class to efficiently list all of the objects in an S3 bucket, without loading
 * them all into memory at once.  Handles paging of listS3ObjectsV2 requests.
 */
class S3ListObjectsV2Queue {
  private readonly s3: S3;
  private readonly params: ListObjectsV2Request;
  private items: Array<_Object | null>;

  constructor(params: ListObjectsV2Request) {
    this.items = [];
    this.params = params;
    this.s3 = s3();
  }

  /**
   * View the next item in the queue
   *
   * This does not remove the object from the queue.  When there are no more
   * items in the queue, returns 'null'.
   *
   * @returns {Promise<Object>} an S3 object description
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
   * @returns {Promise<Object>} an S3 object description
   */
  async shift() {
    if (this.items.length === 0) await this.fetchItems();
    return this.items.shift();
  }

  private async fetchItems() {
    const response = await this.s3.listObjectsV2(this.params);

    this.items = (response.Contents || []);

    if (response.IsTruncated) {
      this.params.ContinuationToken = response.NextContinuationToken;
    } else this.items.push(null);
  }
}

export = S3ListObjectsV2Queue;
