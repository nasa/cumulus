'use strict';

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
}
module.exports = AsyncOperation;
