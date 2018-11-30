// Update with your config settings.

module.exports = {};

module.exports.development = {
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
  },
  migrations: {
    directory: 'knex_migrations',
    tableName: 'knex_migrations'
  }
};

module.exports.test = module.exports.development;
