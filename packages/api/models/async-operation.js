'use strict';

const cloneDeep = require('lodash.clonedeep');
const uuidv4 = require('uuid/v4');
const Manager = require('./base');
const { asyncOperations: asyncOperationsSchema } = require('./schemas');

class AsyncOperation extends Manager {
  constructor(params) {
    super({
      tableName: params.tableName,
      tableHash: { name: 'id', type: 'S' },
      tableSchema: asyncOperationsSchema
    });
  }

  /**
   * Create one or many async operations
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

    const itemsWithId = itemsArray.map((item) => Object.assign(
      cloneDeep(item),
      { id: uuidv4() }
    ));

    const createdItemOrItems = await super.create(itemsWithId);

    // If the original items argument was an Array, return an Array.  If the
    // original items argument was an Object, return an Object.
    return Array.isArray(items) ? createdItemOrItems : createdItemOrItems[0];
  }
}
module.exports = AsyncOperation;
