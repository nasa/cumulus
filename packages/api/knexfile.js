'use strict';

const parseConnection = require('knex/lib/util/parse-connection');

// See https://github.com/mysqljs/mysql for more on this
function typeCastTinyToBool(field, next) {
  if (field.type === 'TINY' && field.length === 1) {
    return (field.string() === '1');
  }
  return next();
}

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

// This addresses mysql not having a native Bool type.
if (config.client === 'mysql') {
  config.connection.typeCast = typeCastTinyToBool;
}

module.exports = config;
