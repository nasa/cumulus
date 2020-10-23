import Knex from 'knex';

export const getDbClient = (knex: Knex, tableName: string) =>
  knex(tableName);

export const getDbTransaction = (trx: Knex.Transaction, tableName: string) =>
  trx(tableName);

export const doesRecordExist = async (params: object, knex: Knex, tableName: string) =>
  await getDbClient(knex, tableName).where(params).first() !== undefined;
