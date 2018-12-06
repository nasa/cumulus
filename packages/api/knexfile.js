'use strict';

const parseConnection = require('knex/lib/util/parse-connection');

let config;
if (process.env.DATABASE_URL) {
  config = parseConnection(process.env.DATABASE_URL);
}
else {
  config = {
    client: 'mysql',
    connection: {
      host: '127.0.0.1',
      database: 'cumulus',
      user: 'cumulus',
      password: 'password'
    }
  };
}

config.migrations = {
  directory: 'knex_migrations',
  tableName: 'knex_migrations'
};

module.exports = config;
