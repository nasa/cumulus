'use strict';

const Manager = require('./base');

class User extends Manager {
  constructor() {
    super({
      tableName: process.env.UsersTable,
      tableHash: { name: 'userName', type: 'S' }
    });
  }

  delete(userName) {
    return super.delete({ userName });
  }
}
module.exports = User;
