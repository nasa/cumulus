import Knex from 'knex';

export const doesRecordExist = async (params: object, knex: Knex, tableName: string) =>
  await knex(tableName).where(params).first() !== undefined;
