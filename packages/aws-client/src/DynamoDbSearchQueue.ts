import {
  DynamoDBDocument,
} from '@aws-sdk/lib-dynamodb';
import {
  AttributeValue,
  ScanCommandInput,
  QueryCommandInput,
} from '@aws-sdk/client-dynamodb';
import { dynamodbDocClient } from './services';

type SearchType = 'scan' | 'query';
type SearchParams = ScanCommandInput | QueryCommandInput;

/**
 * Class to efficiently search all of the items in a DynamoDB table, without loading them all into
 * memory at once.  Handles paging.
 */
class DynamoDbSearchQueue {
  private readonly dynamodbDocClient: DynamoDBDocument;
  private readonly searchType: SearchType;
  private readonly params: SearchParams;
  private items: (Record<string, AttributeValue> | null)[];

  constructor(params: SearchParams, searchType: SearchType = 'scan') {
    this.items = [];
    this.params = params;
    this.dynamodbDocClient = dynamodbDocClient();
    this.searchType = searchType;
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
   * @returns {Promise<Object>} an item from the DynamoDB table
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
   * @returns {Promise<Object>} an item from the DynamoDB table
   */
  async shift() {
    if (this.items.length === 0) await this.fetchItems();
    return this.items.shift();
  }

  /**
   * A DynamoDbSearchQueue instance stores the list of items to be returned in
   * the `this.items` array. When that list is empty, the `fetchItems()` method
   * is called to repopulate `this.items`. Typically, the new items are fetched
   * using the `DynamoDBDocument.scan()` method.
   *
   * DynamoDB scans up to 1 MB of items at a time and then filters that 1 MB to
   * look for matching items. If there are more items to be search beyond that
   * 1 MB limit, the scan response will include a `LastEvaluatedKey` property.
   * Future calls to `scan()` should set `ExclusiveStartKey` equal to that
   * `LastEvaluatedKey`, so that DynamoDB knows where to resume the search.
   *
   * Because DynamoDB only applies filtering to 1 MB at a time, it's possible
   * that a particular 1 MB chunk may not contain any items that match the
   * filter. In that case, the response from `scan()` will contain an empty list
   * of items and a `LastEvaluatedKey` indicating that there are still more
   * items to be scanned.
   *
   * The goal of `fetchItems()` is to either add more items to `this.items` or,
   * if the entire Dynamo table has been scanned, push `null` onto the list of
   * items. It will continue to call `scan()` until one of those two conditions
   * has been satisfied.
   *
   * Reference: https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-lib-dynamodb/Class/DynamoDBDocument/
   *
   * @private
   */
  async fetchItems() {
    let response;
    do {
      if (this.searchType === 'scan') {
        response = await this.dynamodbDocClient.scan(this.params); // eslint-disable-line no-await-in-loop, max-len
      } else if (this.searchType === 'query') {
        response = await this.dynamodbDocClient.query(this.params); // eslint-disable-line no-await-in-loop, max-len
      }
      if (response?.LastEvaluatedKey) this.params.ExclusiveStartKey = response.LastEvaluatedKey;
    } while ((response?.Items || []).length === 0 && response?.LastEvaluatedKey);

    this.items = (response?.Items || []);

    if (!response?.LastEvaluatedKey) this.items.push(null);
  }
}

export = DynamoDbSearchQueue;
