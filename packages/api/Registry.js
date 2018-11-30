'use strict';

const knexModule = require('knex');

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
    if (!this._knex) {
      this._knex = knexModule({
        client: 'pg',
        connection: {
          host: '127.0.0.1',
          database: 'postgres',
          user: 'postgres',
          password: 'password'
        },
        pool: {
          min: 2,
          max: 10
        }
      });
    }

    return this._knex;
  }
}

module.exports = Registry;
