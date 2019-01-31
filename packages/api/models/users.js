'use strict';

const Manager = require('./base');
const schemas = require('./schemas');

class User extends Manager {
  constructor(params = {}) {
    super({
      tableName: params.tableName || process.env.UsersTable,
      tableHash: { name: 'userName', type: 'S' },
      schema: schemas.user
    });
  }

  delete(userName) {
    return super.delete({ userName });
  }
}
module.exports = User;
