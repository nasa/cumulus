'use strict';

const Manager = require('./base');
const Collection = require('./collections');
const Granule = require('./granules');
const Pdr = require('./pdrs');
const Provider = require('./providers');

class User extends Manager {
  constructor() {
    super(process.env.UsersTable);
  }
}

module.exports = {
  User,
  Collection,
  Granule,
  Pdr,
  Provider,
  Manager
};
