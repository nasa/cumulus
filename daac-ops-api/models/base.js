'use strict';

const Ajv = require('ajv');
const AWS = require('aws-sdk');
const omit = require('lodash.omit');
const getEndpoint = require('@cumulus/ingest/aws').getEndpoint;
const errorify = require('../utils').errorify;
const RecordDoesNotExist = require('../errors').RecordDoesNotExist;

/**
 * The manager class handles basic operations on a given DynamoDb table
 *
 */
class Manager {
  static recordIsValid(item, schema = null, removeAdditional = false) {
    if (schema) {
      const ajv = new Ajv({
        useDefaults: true,
        v5: true,
        removeAdditional: removeAdditional
      });
      const validate = ajv.compile(schema);
      const valid = validate(item);
      if (!valid) {
        throw validate.errors;
      }
    }
  }

  static async createTable(tableName, hash, range = null) {
    const dynamodb = new AWS.DynamoDB(getEndpoint());

    const params = {
      TableName: tableName,
      AttributeDefinitions: [{
        AttributeName: hash.name,
        AttributeType: hash.type
      }],
      KeySchema: [{
        AttributeName: hash.name,
        KeyType: 'HASH'
      }],
      ProvisionedThroughput: {
        ReadCapacityUnits: 5,
        WriteCapacityUnits: 5
      }
    };

    if (range) {
      params.KeySchema.push({
        AttributeName: range.name,
        KeyType: 'RANGE'
      });

      params.AttributeDefinitions.push({
        AttributeName: range.name,
        AttributeType: range.type
      });
    }

    return dynamodb.createTable(params).promise();
  }

  static async deleteTable(tableName) {
    const dynamodb = new AWS.DynamoDB(getEndpoint());
    await dynamodb.deleteTable({
      TableName: tableName
    }).promise();
  }

  /**
   * constructor of Manager class
   *
   * @param {string} tableName the name of the table
   * @returns {object} an instance of Manager class
   */
  constructor(tableName, schema = {}) {
    this.tableName = tableName;
    this.schema = schema; // variable for the record's json schema
    this.dynamodb = new AWS.DynamoDB.DocumentClient(getEndpoint());
    this.removeAdditional = false;
  }

  /**
   * Gets the item if found. If the record does not exist
   * the function throws RecordDoesNotExist error
   *
   * @param {object} item the item to search for
   * @returns {Promise} The record found
   */
  async get(item) {
    const params = {
      TableName: this.tableName,
      Key: item
    };

    try {
      const r = await this.dynamodb.get(params).promise();
      if (!r.Item) {
        throw new RecordDoesNotExist();
      }
      return r.Item;
    }
    catch (e) {
      throw new RecordDoesNotExist(
        `No record found for ${JSON.stringify(item)} in ${this.tableName}`
      );
    }
  }

  async batchGet(items, attributes = null) {
    const params = {
      RequestItems: {
        [this.tableName]: {
          Keys: items
        }
      }
    };

    if (attributes) {
      params.RequestItems[this.tableName].AttributesToGet = attributes;
    }

    return this.dynamodb.batchGet(params).promise();
  }

  async batchWrite(_deletes, _puts) {
    let deletes = _deletes;
    let puts = _puts;
    deletes = deletes ? deletes.map(d => ({ DeleteRequest: { Key: d } })) : [];
    puts = puts ? puts.map((_d) => {
      const d = _d;
      d.updatedAt = Date.now();
      return { PutRequest: { Item: d } };
    }) : [];

    const items = deletes.concat(puts);

    if (items.length > 25) {
      throw new Error('Batch Write supports 25 or fewer bulk actions at the same time');
    }

    const params = {
      RequestItems: {
        [this.tableName]: items
      }
    };

    return this.dynamodb.batchWrite(params).promise();
  }

  /**
   * creates record(s)
   *
   * @param {object|array} items the Item/Items to be added to the database
   */
  async create(items) {
    const single = async (_item) => {
      const item = _item;
      // add createdAt and updatedAt
      item.createdAt = item.createdAt || Date.now();
      item.updatedAt = Date.now();

      this.constructor.recordIsValid(item, this.schema, this.removeAdditional);

      const params = {
        TableName: this.tableName,
        Item: item
      };

      await this.dynamodb.put(params).promise();
    };

    if (items instanceof Array) {
      for (const item of items) {
        await single(item);
      }
      return items;
    }
    await single(items);

    return items;
  }

  async scan(query, fields) {
    const params = {
      TableName: this.tableName,
      FilterExpression: query.filter,
      ExpressionAttributeValues: query.values
    };

    if (query.names) {
      params.ExpressionAttributeNames = query.names;
    }

    if (fields) {
      params.ProjectionExpression = fields;
    }

    return this.dynamodb.scan(params).promise();
  }

  async delete(item) {
    const params = {
      TableName: this.tableName,
      Key: item
    };

    return this.dynamodb.delete(params).promise();
  }

  async update(key, _item, keysToDelete = []) {
    let item = _item;
    const params = {
      TableName: this.tableName,
      Key: key,
      ReturnValues: 'ALL_NEW'
    };

    // remove the keysToDelete from item if there
    item = omit(item, keysToDelete);
    item.updatedAt = Date.now();

    // merge key and item for validation
    // TODO: find a way to implement this
    // as of now this always fail because the updated record is partial
    //const validationObject = Object.assign({}, key, item);
    //this.constructor.recordIsValid(validationObject);

    // remove the key is not included in the item
    item = omit(item, Object.keys(key));

    const attributeUpdates = {};

    // build the update attributes
    Object.keys(item).forEach((k) => {
      attributeUpdates[k] = {
        Action: 'PUT',
        Value: item[k]
      };
    });

    // add keys to be removed
    keysToDelete.forEach((k) => {
      attributeUpdates[k] = { Action: 'DELETE' };
    });

    params.AttributeUpdates = attributeUpdates;

    const response = await this.dynamodb.update(params).promise();
    return response.Attributes;
  }

  /**
   * Updates the status field
   *
   */
  async updateStatus(key, status) {
    return this.update(key, { status });
  }


  /**
   * Marks the record is failed with proper status
   * and error message
   *
   */
  async hasFailed(key, err) {
    return this.update(
      key,
      { status: 'failed', error: errorify(err), isActive: false }
    );
  }
}

module.exports = Manager;
