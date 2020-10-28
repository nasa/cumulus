import Knex from 'knex';

export const doesRecordExist = async<T>(
  params: Partial<T>,
  knex: Knex,
  tableName: string
): Promise<boolean> => await knex<T>(tableName).where(params).first() !== undefined;
