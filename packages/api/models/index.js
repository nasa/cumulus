'use strict';

const Manager = require('./base');
const Collection = require('./collections');
const Granule = require('./granules');
const Pdr = require('./pdrs');
const Provider = require('./providers');
const Rule = require('./rules');
const Execution = require('./executions');
const FileClass = require('./files');

class User extends Manager {
  constructor(usersTable) {
    // The usersTable argument is used when this class is used in tests, and
    // the environment variable is used when this class is used in AWS Lambda
    // functions.
    super(usersTable || process.env.UsersTable);
  }
}

module.exports = {
  User,
  Collection,
  Granule,
  Pdr,
  Provider,
  Rule,
  Manager,
  Execution,
  FileClass
};
