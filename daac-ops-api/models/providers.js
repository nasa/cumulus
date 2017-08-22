'use strict';

const Manager = require('./base');
const Crypto = require('@cumulus/ingest/aws').DefaultProvider;
const providerSchema = require('../schemas').provider;

class Provider extends Manager {
  constructor() {
    super(process.env.ProvidersTable, providerSchema);
    this.removeAdditional = 'all';
  }

  async encryptPassword(password) {
    return await Crypto.encrypt(password);
  }

  async decryptPassword(password) {
    return await Crypto.decrypt(password);
  }

  async update(key, _item, keysToDelete = []) {
    const item = _item;
    // encrypt the password
    if (item.config && item.config.password) {
      item.config.password = await this.encryptPassword(item.config.password);
    }

    return super.update(key, item, keysToDelete);
  }

  async create(_items) {
    const items = _items;
    if (items instanceof Array) {
      for (const item of items) {
        if (!item.regex) {
          item.regex = {};
        }
      }
    }
    else {
      items.regex = {};
    }

    // encrypt the password
    if (items.config && items.config.password) {
      items.config.password = await this.encryptPassword(items.config.password);
    }

    return super.create(items);
  }

  async addRegex(name, granuleIdExtraction, collectionName) {
    const params = {
      TableName: this.tableName,
      Key: { name: name },
      UpdateExpression: 'SET regex.#collectionName = :value',
      ExpressionAttributeNames: {
        '#collectionName': collectionName
      },
      ExpressionAttributeValues: {
        ':value': granuleIdExtraction
      },
      ReturnValues: 'ALL_NEW'
    };

    const response = await this.dynamodb.update(params).promise();
    return response.Attributes;
  }

  async removeRegex(name, collectionName) {
    const params = {
      TableName: this.tableName,
      Key: { name: name },
      UpdateExpression: 'REMOVE regex.#collectionName',
      ExpressionAttributeNames: {
        '#collectionName': collectionName
      },
      ReturnValues: 'ALL_NEW'
    };

    const response = await this.dynamodb.update(params).promise();
    return response.Attributes;
  }

  /**
   * Sets the PDR record to active and updates status to ingesting
   *
   */
  async restart(name) {
    return this.update(
      { name: name },
      { status: 'ingesting', isActive: true },
      ['error'] // keys to delete
    );
  }
}

module.exports = Provider;
