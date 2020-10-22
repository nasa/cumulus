import Knex from 'knex';

const executionsTableName = 'executions';

export const getDbClient = (knex: Knex) =>
  knex(executionsTableName);

export const getDbTransaction = (trx: Knex.Transaction) =>
  trx(executionsTableName);

export const doesExecutionExist = async (params: object, knex: Knex) =>
  await getDbClient(knex).where(params).first() !== undefined;
