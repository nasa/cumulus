'use strict';

const knexModule = require('knex');
const knexConfig = require('../knexfile');

let soleInstance;

class Registry {
  static getInstance() {
    if (!soleInstance) {
      soleInstance = new Registry();
    }

    return soleInstance;
  }

  static knex() {
    return Registry.getInstance().knex();
  }

  knex() {
    if (!this._knex) this._knex = knexModule(knexConfig);

    return this._knex;
  }
}

module.exports = Registry;
