'use strict';

const moment = require('moment');

const DynamoDb = require('@cumulus/aws-client/DynamoDb');

const Manager = require('./base');
const { accessToken: accessTokenSchema } = require('../lib/schemas');

class AccessToken extends Manager {
  constructor(params = {}) {
    super({
      tableName: params.tableName || process.env.AccessTokensTable,
      tableHash: { name: 'accessToken', type: 'S' },
      schema: accessTokenSchema,
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
        ConsistentRead: true,
      },
    });
  }

  /**
   * Get the default expiration time for an access token.
   *
   * @returns {number} - the expiration timestamp, in seconds
   */
  _getDefaultExpirationTime() {
    const currentTimeInSecs = moment().unix();
    const oneHourInSecs = 60 * 60;
    return currentTimeInSecs + oneHourInSecs;
  }

  /**
   * Create the access token record.
   *
   * @param {Object} item - the access token record
   * @returns {Promise<Object>} the created record
   * @see #constructor
   * @see Manager#create
   */
  create(item) {
    const record = item.expirationTime
      ? item
      : {
        ...item,
        expirationTime: this._getDefaultExpirationTime(),
      };
    return super.create(record);
  }
}
module.exports = AccessToken;
