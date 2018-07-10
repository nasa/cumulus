'use strict';

const Ajv = require('ajv');
const cloneDeep = require('lodash.clonedeep');
const omit = require('lodash.omit');
const aws = require('@cumulus/common/aws');
const { errorify } = require('../lib/utils');
const { RecordDoesNotExist } = require('../lib/errors');

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
        const err = {
          message: 'The record has validation errors',
          detail: validate.errors
        };
        throw err;
      }
    }
  }

  static async createTable(tableName, hash, range = null) {
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
      },
      StreamSpecification: {
        StreamEnabled: true,
        StreamViewType: 'NEW_AND_OLD_IMAGES'
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

    const output = await aws.dynamodb().createTable(params).promise();
    await aws.dynamodb().waitFor('tableExists', { TableName: tableName }).promise();
    return output;
  }

  static async deleteTable(tableName) {
    const output = await aws.dynamodb().deleteTable({
      TableName: tableName
    }).promise();

    await aws.dynamodb().waitFor('tableNotExists', { TableName: tableName }).promise();
    return output;
  }

  /**
   * constructor of Manager class
   *
   * @param {string} tableName - the name of the table
   * @param {Object} schema - the json schema to validate the records against
   * @returns {Object} an instance of Manager class
   */
  constructor(tableName, schema = {}) {
    this.tableName = tableName;
    this.schema = schema; // variable for the record's json schema
    this.dynamodbDocClient = aws.dynamodbDocClient({ convertEmptyValues: true });
    this.removeAdditional = false;
  }

  /**
   * Gets the item if found. If the record does not exist
   * the function throws RecordDoesNotExist error
   *
   * @param {Object} item - the item to search for
   * @returns {Promise} The record found
   */
  async get(item) {
    const params = {
      TableName: this.tableName,
      Key: item
    };

    try {
      const r = await this.dynamodbDocClient.get(params).promise();
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

    return this.dynamodbDocClient.batchGet(params).promise();
  }

  async batchWrite(_deletes, _puts) {
    let deletes = _deletes;
    let puts = _puts;
    deletes = deletes ? deletes.map((d) => ({ DeleteRequest: { Key: d } })) : [];
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

    return this.dynamodbDocClient.batchWrite(params).promise();
  }

  /**
   * creates record(s)
   *
   * @param {Object<Array|Object>} items - the Item/Items to be added to the database
   * @returns {Promise<Array|Object>} an array of created records or a single
   *   created record
   */
  async create(items) {
    // This is confusing because the argument named "items" could either be
    // an Array of items  or a single item.  To make this function a little
    // easier to understand, converting the single item case here to an array
    // containing one item.
    const itemsArray = Array.isArray(items) ? items : [items];

    // For each item, set the updatedAt property.  If it does not have a
    // createdAt property, set that as well.  Instead of modifying the original
    // item, this returns an updated copy of the item.
    const itemsWithTimestamps = itemsArray.map((item) => {
      const clonedItem = cloneDeep(item);
      clonedItem.updatedAt = Date.now();
      if (!clonedItem.createdAt) clonedItem.createdAt = clonedItem.updatedAt;
      return clonedItem;
    });

    // Make sure that all of the items are valid
    itemsWithTimestamps.forEach((item) => {
      this.constructor.recordIsValid(item, this.schema, this.removeAdditional);
    });

    // Suggested method of handling a loop containing an await, according to
    // https://codeburst.io/javascript-async-await-with-foreach-b6ba62bbf404
    for (let i = 0; i < itemsWithTimestamps.length; i += 1) {
      await this.dynamodbDocClient.put({ // eslint-disable-line no-await-in-loop
        TableName: this.tableName,
        Item: itemsWithTimestamps[i]
      }).promise();
    }

    // If the original item was an Array, return an Array.  If the original item
    // was an Object, return an Object.
    return Array.isArray(items) ? itemsWithTimestamps : itemsWithTimestamps[0];
  }

  async scan(query, fields, limit, select, startKey) {
    const params = {
      TableName: this.tableName
    };

    if (query) {
      if (query.filter && query.values) {
        params.FilterExpression = query.filter;
        params.ExpressionAttributeValues = query.values;
      }

      if (query.names) {
        params.ExpressionAttributeNames = query.names;
      }
    }

    if (fields) {
      params.ProjectionExpression = fields;
    }

    if (limit) {
      params.Limit = limit;
    }

    if (select) {
      params.Select = select;
    }

    if (startKey) {
      params.ExclusiveStartKey = startKey;
    }

    const resp = await this.dynamodbDocClient.scan(params).promise();

    // recursively go through all the records
    if (resp.LastEvaluatedKey) {
      const more = await this.scan(query, fields, limit, select, resp.LastEvaluatedKey);
      if (more.Items) {
        resp.Items = more.Items.concat(more.Items);
      }
      resp.Count += more.Count;
    }

    return resp;
  }

  async delete(item) {
    const params = {
      TableName: this.tableName,
      Key: item
    };

    return this.dynamodbDocClient.delete(params).promise();
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

    const response = await this.dynamodbDocClient.update(params).promise();
    return response.Attributes;
  }

  /**
   * Updates the status field
   *
   * @param {Object} key - the key to update
   * @param {string} status - the new status
   * @returns {Promise} the updated record
   */
  updateStatus(key, status) {
    return this.update(key, { status });
  }


  /**
   * Marks the record is failed with proper status
   * and error message
   *
   * @param {Object} key - the key to update
   * @param {Object} err - the error object
   * @returns {Promise} the updated record
   */
  hasFailed(key, err) {
    return this.update(
      key,
      { status: 'failed', error: errorify(err), isActive: false }
    );
  }
}

module.exports = Manager;
