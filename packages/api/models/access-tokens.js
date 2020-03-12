'use strict';

const DynamoDb = require('@cumulus/aws-client/DynamoDb');
const Manager = require('./base');
const { accessToken: accessTokenSchema } = require('./schemas');

class AccessToken extends Manager {
  constructor(params = {}) {
    super({
      tableName: params.tableName || process.env.AccessTokensTable,
      tableHash: { name: 'accessToken', type: 'S' },
      schema: accessTokenSchema
    });
  }

  /**
   * Gets the item if found. If the record does not exist
   * the function throws RecordDoesNotExist error
   *
   * Enforces strongly consistent reads for the DynamoDB get operation.
   *
   * @param {Object} item - the item to search for
   * @returns {Promise} The record found
   */
  get(item) {
    return DynamoDb.get({
      tableName: this.tableName,
      item,
      client: this.dynamodbDocClient,
      getParams: {
        ConsistentRead: true
      }
    });
  }
}
module.exports = AccessToken;
