import Knex from 'knex';

export const isRecordDefined = <T>(record: T) => record !== undefined;

export const doesRecordExist = async<T>(
  params: Partial<T>,
  knex: Knex,
  tableName: string
): Promise<boolean> => isRecordDefined(await knex<T>(tableName).where(params).first());
