import Knex from 'knex';

const knex = Knex({
  client: 'pg',
  connection: {
    host: process.env.PG_HOST,
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    database: process.env.PG_DATABASE,
  },
  asyncStackTraces: true,
});

export const createCollection = (data: object) =>
  knex('collections').insert(data);
