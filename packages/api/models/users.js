'use strict';

const Manager = require('./base');

class User extends Manager {
  constructor(params = {}) {
    const tableName = params.tableName || process.env.UsersTable;

    super({
      tableName,
      tableHash: { name: 'userName', type: 'S' }
    });
  }

  delete(userName) {
    return super.delete({ userName });
  }
}
module.exports = User;
