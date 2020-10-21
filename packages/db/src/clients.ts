import Knex from 'knex';

export const getExecutionDbClient = async (knex: Knex) =>
  knex('executions');
