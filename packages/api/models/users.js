'use strict';

const Manager = require('./base');

class User extends Manager {
  constructor(usersTable) {
    // The usersTable argument is used when this class is used in tests, and
    // the environment variable is used when this class is used in AWS Lambda
    // functions.
    super({
      tableName: usersTable || process.env.UsersTable,
      tableHash: { name: 'userName', type: 'S' }
    });
  }
}
module.exports = User;
